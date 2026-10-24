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
import { readAll } from "../db/readAll.js";
import { inChunks } from "../db/inChunks.js";
import { NON_PUBLIC_STATUSES } from "./processLifecycle.js";

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

// --- controllers ---

/** One published brief's row, as the public outcomes index reads it. */
export interface PublishedBriefRow {
  id: string;
  title: string | null;
  state: Record<string, unknown>;
  is_sample: boolean;
  added_in_demo: boolean;
}

/**
 * Every published brief that is still public (not pending review or archived),
 * ordered by id. Paged: a hub can have more than 1,000 of these (PostgREST's cap).
 */
export async function publishedBriefRows(): Promise<PublishedBriefRow[]> {
  return readAll((from, to) =>
    db()
      .from("processes")
      .select<PublishedBriefRow>("id, title, state, is_sample, added_in_demo")
      .eq("type", "civic.brief")
      .eq("state->>publication_status", "published")
      .not("status", "in", `(${[...NON_PUBLIC_STATUSES].join(",")})`)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/** The type and title of each of these processes, read in chunks of 200 ids. */
export async function processTypesAndTitles(
  ids: string[],
): Promise<Array<{ id: string; type: string; title: string }>> {
  return inChunks(ids, (chunk) =>
    db().from("processes").select<{ id: string; type: string; title: string }>("id, type, title").in("id", chunk),
  );
}

/** A process's full row; throws when there is not exactly one. */
export async function readProcessRow(processId: string): Promise<Record<string, unknown>> {
  return db().from("processes").select("*").eq("id", processId).single();
}

/** Insert a process row as given, stamped with the hub in scope. For the dev seed. */
export async function insertProcessRow(row: Record<string, unknown>): Promise<void> {
  await db().from("processes").insert(row);
}
