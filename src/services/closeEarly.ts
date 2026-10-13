// Close early, on the shared action path (Actions slice, 2026-10-13).
//
// An admin may close a process before its deadline by calling the action its
// descriptor names for the deadline (`deadline.action`): the same action, and
// so the same flow, as the hub's own close at the deadline (closed state, the
// closing card, the brief). The differences are here:
//
//   - the admin must give a note (`payload.note`, at most 1,000 characters);
//   - the close records `state.closed_early` { at, original_deadline, note }
//     in the same write as the close, and on the close's events;
//   - the hub admin audit log records who closed it.
//
// Universal: any type with a deadline gets it from its descriptor. Projects
// have no deadline and are untouched. A close by the hub (`system`), or an
// admin's after the deadline has passed, is an ordinary close.

import { ValidationError } from "../errors/index.js";
import { forHub, HUB_TABLES, type TableName } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { getUser } from "../modules/civic.auth/index.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { reportError } from "../utils/reportError.js";
import { CLOSE_EARLY_NOTE_MAX, closedEarlyLine, readClosedEarly, type ClosedEarlyRecord } from "../shared/closedEarly.js";
import { resolveTimeZone } from "../utils/hubTime.js";
import { getSettingSync } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import type { Process, ProcessAction } from "../models/process.js";
import type { ProcessHandler, ActionCaller } from "../processes/types.js";
import type { CivicEvent } from "../models/event.js";

export interface EarlyClose {
  originalDeadline: string;
  note: string;
}

/**
 * Where a descriptor says a deadline lives: "state.<path>" on the process, or
 * "<table>.<column>" on the type's row with the process's id.
 */
export async function readDeadline(source: string, process: Process): Promise<string | null> {
  const [head, ...rest] = source.split(".");
  let value: unknown;
  if (head === "state") {
    value = rest.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), process.state);
  } else {
    // A descriptor names one of the hub's tables (descriptorCheck checks it).
    if (!(HUB_TABLES as readonly string[]).includes(head)) return null;
    const row = await forHub(currentHubId())
      .from(head as TableName)
      .select<Record<string, unknown>>(rest.join("."))
      .eq("id", process.id)
      .maybeSingle();
    value = row?.[rest.join(".")];
  }
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Whether this call is an admin closing the process before its deadline, and
 * if so its note. Refuses a missing or overlong note (400) before anything
 * runs. Null for every other call.
 */
export async function earlyCloseOf(
  handler: ProcessHandler,
  process: Process,
  action: ProcessAction,
  caller: ActionCaller,
): Promise<EarlyClose | null> {
  const deadline = handler.descriptor?.deadline;
  if (caller !== "admin" || !deadline || action.type !== deadline.action) return null;
  const due = await readDeadline(deadline.source, process);
  if (!due || Date.parse(due) <= Date.now()) return null;
  const raw = (action.payload ?? {}).note;
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) {
    throw new ValidationError(
      "Write a note saying why this is closing before its deadline. It is shown on the page and in the brief.",
      "note_required",
    );
  }
  if (note.length > CLOSE_EARLY_NOTE_MAX) {
    throw new ValidationError(`The note can be at most ${CLOSE_EARLY_NOTE_MAX} characters.`, "note_too_long");
  }
  return { originalDeadline: new Date(due).toISOString(), note };
}

/**
 * Record an early close on the process (written with the close) and on the
 * close's events. Returns the record.
 */
export function stampEarlyClose(process: Process, events: CivicEvent[], early: EarlyClose): ClosedEarlyRecord {
  const record: ClosedEarlyRecord = { at: new Date().toISOString(), original_deadline: early.originalDeadline, note: early.note };
  (process.state as Record<string, unknown>).closed_early = record;
  for (const event of events) {
    event.data = { ...(event.data ?? {}), closed_early: record };
  }
  return record;
}

/**
 * The admin log's line: who closed what, when it was due, and the note. After
 * the close has committed; a failed write is reported, not thrown, since the
 * close itself (and its record on the process) already stands.
 */
export async function auditEarlyClose(process: Process, actorId: string, record: ClosedEarlyRecord): Promise<void> {
  try {
    const user = await getUser(actorId);
    await recordHubAdminAudit({
      actor: user?.email ?? actorId,
      action: "process.close_early",
      before: { status_deadline: record.original_deadline },
      after: { process_id: process.id, process_type: process.definition.type, title: process.title, closed_at: record.at, note: record.note },
    });
  } catch (err) {
    reportError("audit.close_early", "the admin log did not record an early close", {
      process_id: process.id,
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}

/** A process's early-close record as its page and brief show it, or null. */
export function closedEarlyView(state: unknown): (ClosedEarlyRecord & { line: string }) | null {
  const record = readClosedEarly((state as Record<string, unknown> | null)?.closed_early);
  if (!record) return null;
  return { ...record, line: closedEarlyLine(record, resolveTimeZone(getSettingSync(KEYS.IDENTITY_TIMEZONE))) };
}

/**
 * Whether this process can be closed early now, and by which action: a type
 * with a deadline, at a status its deadline action runs from, before the
 * deadline. Pages show an admin the Close early button from this (the server
 * still decides who may). Null otherwise.
 */
export async function earlyCloseOffer(
  handler: ProcessHandler | undefined,
  process: Process,
): Promise<{ action: string; deadline: string } | null> {
  const deadline = handler?.descriptor?.deadline;
  if (!deadline) return null;
  const close = handler!.descriptor.actions.find((a) => a.name === deadline.action);
  if (!close || !close.callers.includes("admin") || !close.from.includes(process.status)) return null;
  const due = await readDeadline(deadline.source, process);
  if (!due || Date.parse(due) <= Date.now()) return null;
  return { action: close.name, deadline: new Date(due).toISOString() };
}
