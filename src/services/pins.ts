// Pinning any item (Adam, 2026-11-18): an admin pins a vote, a news item, a
// proposal or anything else to the right column's card, not only an
// announcement. The rules are the board's (src/shared/announcementBoard.ts):
// admins only, an optional end date, at most PINNED_MAX at once. The marks
// are the same flat fields an announcement's state has carried since
// 2026-11-15 (`pinned`, `pinned_at`, `pinned_by`, `pinned_until`), so the
// announcements pinned before this read the same, and the card reads one
// field whatever the type.
//
// Each change is a public `civic.process.updated` with `data.pin`
// ({ change: "pinned" | "unpinned", pinned_until }): the hub's own log says
// who pinned what and when. Pinning does not move an item in the feed and is
// not sent to the Fediverse.
//
// The Announcements package still pins its own from its form and its admin
// tab (packages/civic.announcement), writing the same fields; this is the
// kernel's way for every type, behind each detail page's admin row.

import { getProcess, saveProcessState } from "./processService.js";
import { boardRows } from "./processRows.js";
import { emitEvent } from "../events/eventEmitter.js";
import { NON_PUBLIC_STATUSES } from "./processLifecycle.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { getManifest } from "../processes/registry.js";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { PINNED_MAX, endDateProblem, isPinnedNow, isUrgentNow, type BoardMarks } from "../shared/announcementBoard.js";
import type { Process } from "../models/process.js";

type Marks = BoardMarks & { pinned_by?: string | null; moderation?: { removed?: boolean } | null };

function marksOf(process: Process): Marks {
  return (process.state ?? {}) as Marks;
}

/** How many items other than `exceptId` are pinned right now, of any type (for the cap). */
export async function countPinnedNow(exceptId: string | null): Promise<number> {
  const now = Date.now();
  return (await boardRows()).filter((r) => {
    if (r.id === exceptId) return false;
    const marks = r.state as Marks;
    return !marks.moderation?.removed && isPinnedNow(marks, now);
  }).length;
}

/** A process an admin may pin: public, its plugin on, not removed. */
async function pinnable(id: string): Promise<Process> {
  const process = await getProcess(id);
  if (!process || NON_PUBLIC_STATUSES.includes(process.status) || !isProcessTypeEnabled(process.definition.type)) {
    throw new NotFoundError("Item not found");
  }
  if (marksOf(process).moderation?.removed) {
    throw new ValidationError("A removed item can't be pinned.", "item_removed");
  }
  return process;
}

async function emitPinChange(process: Process, adminId: string, change: "pinned" | "unpinned"): Promise<void> {
  const marks = marksOf(process);
  await emitEvent({
    event_type: "civic.process.updated",
    actor: adminId,
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    processType: process.definition.type,
    action_url_path: getManifest(process.definition.type)?.detailPath(process.id) ?? `/process/${process.id}`,
    data: {
      pin: {
        change,
        ...(change === "pinned" ? { pinned_until: marks.pinned_until ?? null } : {}),
      },
    },
  });
}

/** Pin an item, or change its end date. Admins only (the route checks). */
export async function pinItem(id: string, adminId: string, until: string | null): Promise<Process> {
  const process = await pinnable(id);
  const problem = endDateProblem(until, { required: false });
  if (problem) throw new ValidationError(problem, "pinned_until_invalid");
  const untilIso = until ? new Date(until).toISOString() : null;
  const marks = marksOf(process);
  const already = isPinnedNow(marks);
  if (already && (marks.pinned_until ?? null) === untilIso) return process;
  if (!already && (await countPinnedNow(process.id)) >= PINNED_MAX) {
    throw new ValidationError(`${PINNED_MAX} items are pinned already. Unpin one first.`, "pinned_limit");
  }
  const at = new Date().toISOString();
  process.state = {
    ...process.state,
    pinned: true,
    pinned_at: already ? marks.pinned_at ?? at : at,
    pinned_by: adminId,
    pinned_until: untilIso,
  };
  await emitPinChange(process, adminId, "pinned");
  await saveProcessState(process);
  return process;
}

/** Unpin an item. Nothing happens, and nothing is recorded, when it was not pinned. */
export async function unpinItem(id: string, adminId: string): Promise<Process> {
  const process = await getProcess(id);
  if (!process) throw new NotFoundError("Item not found");
  if (!marksOf(process).pinned) return process;
  process.state = { ...process.state, pinned: false, pinned_until: null };
  await emitPinChange(process, adminId, "unpinned");
  await saveProcessState(process);
  return process;
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

/**
 * Admin → Pinned: every item pinned right now, of any type whose plugin is
 * on, and every announcement marked urgent; urgent first, then the newest
 * pin first (as the card orders them). Removed ones are left out.
 */
export async function listPinned(): Promise<{ items: PinnedRow[]; pinned_count: number; pinned_max: number }> {
  const now = Date.now();
  const items = (await boardRows())
    .filter((r) => isProcessTypeEnabled(r.type))
    .map((r) => ({ r, marks: r.state as Marks & { urgent_until?: string | null; content?: { title?: string } } }))
    .filter(({ marks }) => !marks.moderation?.removed && (isPinnedNow(marks, now) || isUrgentNow(marks, now)))
    .map(({ r, marks }): PinnedRow => {
      const pinned = isPinnedNow(marks, now);
      const urgent = isUrgentNow(marks, now);
      const manifest = getManifest(r.type);
      return {
        id: r.id,
        type: r.type,
        type_label: manifest?.descriptor.display.label ?? r.type,
        title: marks.content?.title || r.title,
        url: manifest?.detailPath(r.id) ?? `/process/${r.id}`,
        pinned,
        pinned_at: pinned ? marks.pinned_at ?? null : null,
        pinned_until: pinned ? marks.pinned_until ?? null : null,
        urgent,
        urgent_until: urgent ? marks.urgent_until ?? null : null,
      };
    })
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""));
  return { items, pinned_count: items.filter((i) => i.pinned).length, pinned_max: PINNED_MAX };
}

/** An item's marks as readers see them: an end date that has passed reads as off. */
export function pinView(process: Process, now: number = Date.now()) {
  const marks = marksOf(process);
  return {
    pinned: isPinnedNow(marks, now),
    pinned_until: isPinnedNow(marks, now) ? marks.pinned_until ?? null : null,
    urgent: isUrgentNow(marks, now),
  };
}
