// Pinning any item (Adam, 2026-11-18; the hub's own since pinning phase 2):
// an admin pins a vote, a news item, a proposal or anything else to the right
// column's Pinned card. Pinning is a hub core feature: the pins live in the
// hub's `process_pins` table (src/stores/pins.ts), not in the item, and no
// plugin writes pin code. The rules are src/shared/pinRules.ts: admins only,
// an optional end date, at most PINNED_MAX at once.
//
// Each change is a public `civic.process.updated` with `data.pin`
// ({ change: "pinned" | "unpinned", pinned_until }): the hub's own log says
// who pinned what and when. Pinning does not move an item in the feed and is
// not sent to the Fediverse.
//
// A plugin may put its own rows on the card above the pins
// (PluginServer.pinnedCard, src/services/pinnedCard.ts): the Announcements
// plugin's urgent announcements. Admin → Pinned lists those too, marked urgent.

import { getProcess } from "./processService.js";
import { processTypesAndTitles, publicCardRows, type CardRow } from "./processRows.js";
import { contributedFirst, pinnedItemLabel } from "./pinnedCard.js";
import { emitEvent } from "../events/eventEmitter.js";
import { NON_PUBLIC_STATUSES } from "./processLifecycle.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { getManifest } from "../processes/registry.js";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { PINNED_MAX, isPinActive, pinEndDateProblem } from "../shared/pinRules.js";
import { deletePin, readPin, readPins, writePin, type PinRow } from "../stores/pins.js";
import type { Process } from "../models/process.js";

type Removable = { moderation?: { removed?: boolean } | null };

function isRemoved(state: Record<string, unknown> | null | undefined): boolean {
  return Boolean((state as Removable | null)?.moderation?.removed);
}

/** A pinned item as the card reads it: its pin and the item's row. */
export type PinnedItemRow = PinRow & Omit<CardRow, "id">;

/**
 * Every pin with its item, public items only. End dates, removal and
 * switched-off plugins are the caller's to read.
 */
export async function readPinnedItems(): Promise<PinnedItemRow[]> {
  const pins = await readPins();
  if (pins.length === 0) return [];
  const byId = new Map((await publicCardRows(pins.map((p) => p.process_id))).map((r) => [r.id, r]));
  return pins.flatMap((pin) => {
    const row = byId.get(pin.process_id);
    if (!row) return [];
    const { id: _id, ...item } = row;
    return [{ ...pin, ...item }];
  });
}

/**
 * The pins readers see right now: end date not passed, the item public and
 * not removed, its plugin on. Admin → Pinned lists these, the card shows
 * them, and the cap counts them, so "8 of 10" is the truth. A pin on an item
 * that is archived, removed, or whose plugin is off stays stored and comes
 * back with it, but holds no place meanwhile.
 */
export async function readVisiblePins(now: number = Date.now()): Promise<PinnedItemRow[]> {
  return (await readPinnedItems()).filter((p) => isPinActive(p, now) && isProcessTypeEnabled(p.type) && !isRemoved(p.state));
}

/** How many items other than `exceptId` are pinned right now, as Admin → Pinned counts them (for the cap). */
export async function countPinnedNow(exceptId: string | null): Promise<number> {
  return (await readVisiblePins()).filter((p) => p.process_id !== exceptId).length;
}

/** A process an admin may pin: public, its plugin on, not removed. */
async function pinnable(id: string): Promise<Process> {
  const process = await getProcess(id);
  if (!process || NON_PUBLIC_STATUSES.includes(process.status) || !isProcessTypeEnabled(process.definition.type)) {
    throw new NotFoundError("Item not found");
  }
  if (isRemoved(process.state)) {
    throw new ValidationError("A removed item can't be pinned.", "item_removed");
  }
  return process;
}

async function emitPinChange(process: Process, adminId: string, change: "pinned" | "unpinned", until: string | null): Promise<void> {
  await emitEvent({
    event_type: "civic.process.updated",
    actor: adminId,
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    processType: process.definition.type,
    action_url_path: getManifest(process.definition.type)?.detailPath(process.id) ?? `/process/${process.id}`,
    data: { pin: { change, ...(change === "pinned" ? { pinned_until: until } : {}) } },
  });
}

/** An item's pin as readers see it: an end date that has passed reads as unpinned. */
export interface PinView {
  id: string;
  pinned: boolean;
  pinned_until: string | null;
}

function viewOf(id: string, pin: PinRow | null, now: number = Date.now()): PinView {
  const pinned = Boolean(pin && isPinActive(pin, now));
  return { id, pinned, pinned_until: pinned ? pin?.pinned_until ?? null : null };
}

/** Pin an item, or change its end date. Admins only (the route checks). */
export async function pinItem(id: string, adminId: string, until: string | null): Promise<PinView> {
  const process = await pinnable(id);
  const problem = pinEndDateProblem(until);
  if (problem) throw new ValidationError(problem, "pinned_until_invalid");
  const untilIso = until ? new Date(until).toISOString() : null;
  const pin = await readPin(process.id);
  const already = Boolean(pin && isPinActive(pin));
  if (already && pin && normal(pin.pinned_until) === untilIso) return viewOf(process.id, pin);
  if (!already && (await countPinnedNow(process.id)) >= PINNED_MAX) {
    throw new ValidationError(`${PINNED_MAX} items are pinned already. Unpin one first.`, "pinned_limit");
  }
  const next: PinRow = {
    process_id: process.id,
    pinned_by: adminId,
    pinned_at: already && pin ? pin.pinned_at : new Date().toISOString(),
    pinned_until: untilIso,
  };
  await emitPinChange(process, adminId, "pinned", untilIso);
  await writePin(next);
  return viewOf(process.id, next);
}

/** Unpin an item. Nothing happens, and nothing is recorded, when it was not pinned. */
export async function unpinItem(id: string, adminId: string): Promise<PinView> {
  const process = await getProcess(id);
  if (!process) throw new NotFoundError("Item not found");
  const pin = await readPin(process.id);
  if (!pin) return viewOf(process.id, null);
  await deletePin(process.id);
  // An expired pin is tidied away without a record: readers saw it as unpinned already.
  if (isPinActive(pin)) await emitPinChange(process, adminId, "unpinned", null);
  return viewOf(process.id, null);
}

/** The database's timestamps come back in its own format: compare as ISO. */
function normal(at: string | null): string | null {
  return at ? new Date(at).toISOString() : null;
}

/** One row of Admin → Pinned. */
export interface PinnedRow {
  id: string;
  type: string;
  type_label: string;
  title: string;
  url: string;
  pinned: boolean;
  pinned_at: string | null;
  pinned_until: string | null;
  urgent: boolean;
  urgent_until: string | null;
}

function labelOf(type: string): string {
  return getManifest(type)?.descriptor.display.label ?? type;
}

/**
 * Admin → Pinned: every item pinned right now, of any type whose plugin is
 * on, and every row a plugin puts at the top of the card (urgent
 * announcements); urgent first, then the newest pin first. Removed ones are
 * left out.
 */
export async function listPinned(): Promise<{ items: PinnedRow[]; pinned_count: number; pinned_max: number }> {
  const now = Date.now();
  const [pinned, first] = await Promise.all([readVisiblePins(now), contributedFirst()]);
  const rows = new Map<string, PinnedRow>();
  for (const p of pinned) {
    const title = (p.state as { content?: { title?: string } }).content?.title;
    rows.set(p.process_id, {
      id: p.process_id,
      type: p.type,
      type_label: pinnedItemLabel(p.type, { process_id: p.process_id, state: p.state }) ?? labelOf(p.type),
      title: title || p.title,
      url: getManifest(p.type)?.detailPath(p.process_id) ?? `/process/${p.process_id}`,
      pinned: true,
      pinned_at: normal(p.pinned_at),
      pinned_until: normal(p.pinned_until),
      urgent: false,
      urgent_until: null,
    });
  }
  const urgent = first.filter((i) => i.urgent);
  const types = new Map((await processTypesAndTitles(urgent.map((i) => i.process_id))).map((r) => [r.id, r.type]));
  for (const item of urgent) {
    const type = types.get(item.process_id);
    if (!type) continue;
    const had = rows.get(item.process_id);
    rows.set(item.process_id, {
      ...(had ?? {
        id: item.process_id,
        type,
        type_label: labelOf(type),
        title: item.title,
        url: item.url,
        pinned: false,
        pinned_at: null,
        pinned_until: null,
      }),
      urgent: true,
      urgent_until: item.until ?? null,
    });
  }
  const items = [...rows.values()].sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""),
  );
  return { items, pinned_count: items.filter((i) => i.pinned).length, pinned_max: PINNED_MAX };
}
