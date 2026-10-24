// The `processes` table's plain reads and writes, for code outside
// processService (ADR-012, the database convention). processService owns the
// table: it and this file are the only code that queries `processes`
// (lint: civic/process-table). processService keeps the lifecycle (create,
// act, close, archive); this file has the row-level reads and writes other
// code needs, so nothing else builds a query on the table. Kept apart from
// processService so a process type's handler can use it without importing
// the lifecycle.
//
// Every read and write is on the hub in scope (forHub).

import { forHub, type HubDb } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";

function db(): HubDb {
  return forHub(currentHubId());
}

/** A process's `state` as stored now, or null when there is no such process. */
export async function readProcessState(processId: string): Promise<Record<string, unknown> | null> {
  const row = await db()
    .from("processes")
    .select<{ state: Record<string, unknown> | null }>("state")
    .eq("id", processId)
    .maybeSingle();
  return row ? { ...(row.state ?? {}) } : null;
}

/**
 * Replace a process's `state`, nothing else (no status change, no event).
 * For a handler's own bookkeeping inside state; a status change goes through
 * processService (transitionProcess) with its event.
 */
export async function writeProcessState(processId: string, state: Record<string, unknown>): Promise<void> {
  await db().from("processes").update({ state }).eq("id", processId);
}
