// Pinning any item (Adam, 2026-11-18; a plugin since kernel step 4,
// 2026-11-19): a pin puts a vote, a news item, a proposal or anything else on
// the right column's Pinned card. The pins live in the plugin's own table
// (`process_pins`, ./store.ts), not in the item, and no other plugin knows of
// them. The rules are ./rules.ts: who may pin is the space's setting, an
// optional end date, an optional urgent flag, at most PINNED_MAX at once.
//
// Each change is a public `civic.process.updated` with `data.pin`
// ({ change: "pinned" | "unpinned", pinned_until, urgent }): the space's own
// log says who pinned what and when. Pinning does not move an item in the
// feed and is not sent to the Fediverse.
//
// Items are read through the kernel's items service (SDK `items`): their
// title, page and type's word, and whether readers see them right now.

import { emitEvent, getProcess, items, NotFoundError, ValidationError, type ItemSummary } from "../../src/sdk/index.js";
import { PINNED_MAX, isPinActive, pinEndDateProblem } from "./rules.js";
import type { PinRow, PinStore } from "./store.js";
import type { BoardRow, PinnedRow, PinView } from "./types.js";

export type { BoardRow, PinnedRow, PinView };

/** A pin readers see right now, with its item. */
export interface VisiblePin {
  pin: PinRow;
  item: ItemSummary;
}

/**
 * The pins readers see right now: end date not passed, the item public and
 * not removed, its plugin on. Admin → Pinned lists these, the card shows
 * them, and the cap counts them, so "8 of 10" is the truth. A pin on an item
 * that is archived, removed, or whose plugin is off stays stored and comes
 * back with it, but holds no place meanwhile.
 */
export async function readVisiblePins(store: PinStore, now: number = Date.now()): Promise<VisiblePin[]> {
  const pins = (await store.all()).filter((p) => isPinActive(p, now));
  if (pins.length === 0) return [];
  const byId = new Map((await items.publicSummaries(pins.map((p) => p.process_id))).map((i) => [i.id, i]));
  return pins.flatMap((pin) => {
    const item = byId.get(pin.process_id);
    return item && item.on && !item.removed ? [{ pin, item }] : [];
  });
}

/** The card: urgent pins first, then the newest item first. */
export async function readBoard(store: PinStore, now: number = Date.now()): Promise<BoardRow[]> {
  return (await readVisiblePins(store, now))
    .map(({ pin, item }): BoardRow => ({
      process_id: item.id,
      title: item.title,
      published_at: item.created_at,
      url: item.url,
      type_label: item.type_label,
      ...(pin.urgent ? { urgent: true as const } : {}),
      ...(item.sample ? { sample: true as const } : {}),
    }))
    .sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) || b.published_at.localeCompare(a.published_at));
}

/** An item that may be pinned: readers see it now. */
async function pinnable(id: string): Promise<ItemSummary> {
  const item = await items.publicSummary(id);
  if (!item) throw new NotFoundError("Item not found");
  if (item.removed) throw new ValidationError("A removed item can't be pinned.", "item_removed");
  return item;
}

async function emitPinChange(item: ItemSummary, actorId: string, change: "pinned" | "unpinned", pin: PinRow | null): Promise<void> {
  const process = await getProcess(item.id);
  if (!process) throw new NotFoundError("Item not found");
  await emitEvent({
    event_type: "civic.process.updated",
    actor: actorId,
    process_id: item.id,
    jurisdiction: process.jurisdiction,
    processType: item.type,
    action_url_path: item.url,
    data: { pin: { change, ...(change === "pinned" && pin ? { pinned_until: pin.pinned_until, urgent: pin.urgent } : {}) } },
  });
}

function viewOf(id: string, pin: PinRow | null, now: number = Date.now()): PinView {
  const pinned = Boolean(pin && isPinActive(pin, now));
  return { id, pinned, pinned_until: pinned ? pin?.pinned_until ?? null : null, urgent: pinned && Boolean(pin?.urgent) };
}

/** An item's pin, for its Pin button. */
export async function readPinView(store: PinStore, id: string): Promise<PinView> {
  return viewOf(id, await store.one(id));
}

/** The database's timestamps come back in its own format: compare as ISO. */
function normal(at: string | null): string | null {
  return at ? new Date(at).toISOString() : null;
}

/**
 * Pin an item, or change its end date or urgent flag (left as it was when
 * not given). The route checks who may.
 */
export async function pinItem(
  store: PinStore,
  id: string,
  actorId: string,
  change: { until: string | null; urgent?: boolean },
): Promise<PinView> {
  const item = await pinnable(id);
  const problem = pinEndDateProblem(change.until);
  if (problem) throw new ValidationError(problem, "pinned_until_invalid");
  const untilIso = change.until ? new Date(change.until).toISOString() : null;
  const pin = await store.one(item.id);
  const already = Boolean(pin && isPinActive(pin));
  const urgent = change.urgent ?? (already && pin ? pin.urgent : false);
  if (already && pin && normal(pin.pinned_until) === untilIso && pin.urgent === urgent) return viewOf(item.id, pin);
  if (!already && (await readVisiblePins(store)).filter((p) => p.pin.process_id !== item.id).length >= PINNED_MAX) {
    throw new ValidationError(`${PINNED_MAX} items are pinned already. Unpin one first.`, "pinned_limit");
  }
  const next: PinRow = {
    process_id: item.id,
    pinned_by: actorId,
    pinned_at: already && pin ? pin.pinned_at : new Date().toISOString(),
    pinned_until: untilIso,
    urgent,
  };
  await emitPinChange(item, actorId, "pinned", next);
  await store.write(next);
  return viewOf(item.id, next);
}

/** Unpin an item. Nothing happens, and nothing is recorded, when it was not pinned. */
export async function unpinItem(store: PinStore, id: string, actorId: string): Promise<PinView> {
  // Any item of this space, public or not (an archived item's pin can be tidied away); another space's is not found.
  if (!(await getProcess(id))) throw new NotFoundError("Item not found");
  const pin = await store.one(id);
  if (!pin) return viewOf(id, null);
  await store.remove(id);
  // An expired pin is tidied away without a record: readers saw it as unpinned already.
  const [item] = await items.publicSummaries([id]);
  if (isPinActive(pin) && item) await emitPinChange(item, actorId, "unpinned", null);
  return viewOf(id, null);
}

/** Admin → Pinned: every item pinned right now; urgent first, then the newest pin first. */
export async function listPinned(store: PinStore): Promise<{ items: PinnedRow[]; pinned_count: number; pinned_max: number }> {
  const rows = (await readVisiblePins(store)).map(
    ({ pin, item }): PinnedRow => ({
      id: item.id,
      type: item.type,
      type_label: item.type_label,
      title: item.title,
      url: item.url,
      pinned_at: normal(pin.pinned_at),
      pinned_until: normal(pin.pinned_until),
      urgent: pin.urgent,
    }),
  );
  rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""));
  return { items: rows, pinned_count: rows.length, pinned_max: PINNED_MAX };
}
