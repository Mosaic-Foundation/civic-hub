// The `processes` table's plain reads and writes, for code outside
// processService (ADR-012, the database convention). processService owns the
// table: it and this file are the only code that queries `processes`
// (lint: civic/process-table). processService keeps the lifecycle (create,
// act, close, archive); this file has the row-level reads and writes other
// code needs, so nothing else builds a query on the table. Kept apart from
// processService so a process type's handler can use it without importing
// the lifecycle.
//
// Every read and write is on the hub in scope (forHub), except the functions
// that take a hub id, which are on that hub.

import { forHub, type HubDb } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { readAll } from "../db/readAll.js";
import { inChunks } from "../db/inChunks.js";
import { NON_PUBLIC_STATUSES, nonPublicStatusFilter } from "./processLifecycle.js";
import type { ProcessStatus } from "../models/process.js";
import type { ProcessRow } from "./processService.js";

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

/** A process's full row; throws (HubDbError, PGRST116) when there is not exactly one. */
export async function readProcessRow(processId: string): Promise<ProcessRow> {
  return db().from("processes").select<ProcessRow>("*").eq("id", processId).single();
}

/** Insert a process row as given, stamped with the hub in scope. For the dev seed. */
export async function insertProcessRow(row: Record<string, unknown>): Promise<void> {
  await db().from("processes").insert(row);
}

// --- proposals, projects and input ---

/** The proposal a process was converted from (`source_proposal_id`), or null. */
export async function readSourceProposalId(processId: string): Promise<string | null> {
  const data = await db()
    .from("processes")
    .select<{ source_proposal_id: string | null }>("source_proposal_id")
    .eq("id", processId)
    .maybeSingle();
  return data?.source_proposal_id ?? null;
}

// --- processes table callers ---

/** How many of a named hub's processes there are, whatever their status. */
export async function countProcessesInHub(hubId: string): Promise<number> {
  return forHub(hubId).from("processes").count();
}

/**
 * How many processes of the given types are pending (the `state` field named
 * `stateKey` reads "pending") among those a list shows. `since` keeps only
 * those created after it; `flaggedOnly` keeps only those with a quality flag.
 */
export async function countPendingByState(
  types: string[],
  stateKey: string,
  opts: { since?: string; flaggedOnly?: boolean } = {},
): Promise<number> {
  let q = db()
    .from("processes")
    .count()
    .in("type", types)
    .not("status", "in", nonPublicStatusFilter())
    .eq(`state->>${stateKey}`, "pending");
  // ->> : a summary with no flag stores JSON null, which -> would read as a
  // value; as text it is SQL NULL.
  if (opts.flaggedOnly) q = q.not("state->>quality_flag", "is", null);
  if (opts.since !== undefined) q = q.gt("created_at", opts.since);
  return q;
}

/** The ids, among `ids`, of processes whose type is one of `types`. */
export async function processIdsOfTypes(ids: string[], types: string[]): Promise<string[]> {
  const rows = await db().from("processes").select<{ id: string }>("id").in("id", ids).in("type", types);
  return rows.map((r) => r.id);
}

/** How many processes of one type a list shows (not under review, not archived) on a named hub. */
export async function countListedProcessesOfType(hubId: string, type: string): Promise<number> {
  return forHub(hubId)
    .from("processes")
    .count()
    .eq("type", type)
    .not("status", "in", nonPublicStatusFilter());
}

/** The id of the civic.brief process made from this source process, or null. */
export async function briefIdForSource(sourceProcessId: string): Promise<string | null> {
  const row = await db()
    .from("processes")
    .select<{ id: string }>("id")
    .eq("type", "civic.brief")
    .eq("state->>source_process_id", sourceProcessId)
    .maybeSingle();
  return row?.id ?? null;
}

/** Id, type, title and status of each of these processes, in id order, read in chunks. */
export async function processHeads(
  ids: string[],
): Promise<Array<{ id: string; type: string; title: string; status: string }>> {
  return inChunks(ids, (chunk) =>
    db()
      .from("processes")
      .select<{ id: string; type: string; title: string; status: string }>("id, type, title, status")
      .in("id", chunk)
      .order("id", { ascending: true }),
  );
}

/** How many of these processes still exist, counted in chunks. */
export async function countExistingProcesses(ids: string[]): Promise<number> {
  const counts = await inChunks(ids, async (chunk) => [await db().from("processes").count().in("id", chunk)]);
  return counts.reduce((a, b) => a + b, 0);
}

/** Status, type and sample flags of these processes (one request, so a short id list). */
export async function processFactRows(
  ids: string[],
): Promise<Array<{ id: string; status: ProcessStatus; type: string; is_sample: boolean; added_in_demo: boolean }>> {
  return db()
    .from("processes")
    .select<{ id: string; status: ProcessStatus; type: string; is_sample: boolean; added_in_demo: boolean }>(
      "id, status, type, is_sample, added_in_demo",
    )
    .in("id", ids);
}

/** The proposal a process was made from, or null (also null when there is no such process). */
export async function sourceProposalIdOf(processId: string): Promise<string | null> {
  const row = await db()
    .from("processes")
    .select<{ source_proposal_id: string | null }>("source_proposal_id")
    .eq("id", processId)
    .maybeSingle();
  return row?.source_proposal_id ?? null;
}

/** Write these columns on one process, nothing else (no status change, no event). */
export async function updateProcessColumns(processId: string, updates: Record<string, unknown>): Promise<void> {
  await db().from("processes").update(updates).eq("id", processId);
}

/** Id, type, title, status, creator and state of these processes, for hydrating link peers. */
export async function processPeerRows(ids: string[]): Promise<
  Array<{
    id: string;
    type: string;
    title: string | null;
    status: string;
    created_by: string | null;
    state: Record<string, unknown> | null;
  }>
> {
  return db()
    .from("processes")
    .select<{
      id: string;
      type: string;
      title: string | null;
      status: string;
      created_by: string | null;
      state: Record<string, unknown> | null;
    }>("id, type, title, status, created_by, state")
    .in("id", ids);
}

/** Id, creator, status, title and type of one process, or null when there is none. */
export async function processOwnerRow(
  processId: string,
): Promise<{ id: string; created_by: string | null; status: string; title: string; type: string } | null> {
  return db()
    .from("processes")
    .select<{ id: string; created_by: string | null; status: string; title: string; type: string }>(
      "id, created_by, status, title, type",
    )
    .eq("id", processId)
    .maybeSingle();
}

/** Id, type and state of one process, or null when there is none. */
export async function processTypeAndState(
  processId: string,
): Promise<{ id: string; type: string; state: Record<string, unknown> | null } | null> {
  return db()
    .from("processes")
    .select<{ id: string; type: string; state: Record<string, unknown> | null }>("id, type, state")
    .eq("id", processId)
    .maybeSingle();
}

/** The frozen wire hostname of each of these processes. */
export async function processWireHostnames(
  ids: string[],
): Promise<Array<{ id: string; wire_hostname: string | null }>> {
  return db()
    .from("processes")
    .select<{ id: string; wire_hostname: string | null }>("id, wire_hostname")
    .in("id", ids);
}

/** Every sample process: id, type and whether a visitor added it on a demo hub. */
export async function sampleProcessHeads(): Promise<Array<{ id: string; type: string; added_in_demo: boolean }>> {
  return db()
    .from("processes")
    .select<{ id: string; type: string; added_in_demo: boolean }>("id, type, added_in_demo")
    .eq("is_sample", true);
}

/** How many processes are not sample content. */
export async function countNonSampleProcesses(): Promise<number> {
  return db().from("processes").count().eq("is_sample", false);
}

/** The ids, among `ids`, that are sample processes. */
export async function sampleProcessIdsIn(ids: string[]): Promise<string[]> {
  const rows = await db().from("processes").select<{ id: string }>("id").in("id", ids).eq("is_sample", true);
  return rows.map((r) => r.id);
}

/** Let go of the review link on these processes. */
export async function clearProcessReviewLinks(ids: string[]): Promise<void> {
  await db().from("processes").update({ review_id: null }).in("id", ids);
}

/** Delete these processes; returns how many there were (0 when none, and nothing is deleted). */
export async function deleteProcesses(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const n = await db().from("processes").count().in("id", ids);
  if (n === 0) return 0;
  await db().from("processes").delete().in("id", ids);
  return n;
}

/** Every sample process with what the sample list needs to show and order it. */
export async function sampleProcessTree(): Promise<
  Array<{
    id: string;
    type: string;
    title: string;
    added_in_demo: boolean;
    source_proposal_id: string | null;
    state: { source_process_id?: unknown } | null;
  }>
> {
  return db()
    .from("processes")
    .select<{
      id: string;
      type: string;
      title: string;
      added_in_demo: boolean;
      source_proposal_id: string | null;
      state: { source_process_id?: unknown } | null;
    }>("id, type, title, added_in_demo, source_proposal_id, state")
    .eq("is_sample", true);
}

/** How many seeded sample processes (not visitors' own) a named hub has; a PromiseLike so the caller can recover from a failed read. */
export function countSeededSampleProcesses(hubId: string): PromiseLike<number> {
  return forHub(hubId).from("processes").count().eq("is_sample", true).eq("added_in_demo", false);
}

/** One process's id, status, state and sample flags, or null when there is none. */
export async function sampleProcessLiveRow(processId: string): Promise<{
  id: string;
  status: string;
  state: Record<string, unknown> | null;
  is_sample: boolean;
  added_in_demo: boolean;
} | null> {
  return db()
    .from("processes")
    .select<{
      id: string;
      status: string;
      state: Record<string, unknown> | null;
      is_sample: boolean;
      added_in_demo: boolean;
    }>("id, status, state, is_sample, added_in_demo")
    .eq("id", processId)
    .maybeSingle();
}

/** The seeded sample processes made from this one (their state or source proposal names it). */
export async function sampleProcessIdsMadeFrom(processId: string): Promise<string[]> {
  const rows = await db()
    .from("processes")
    .select<{ id: string }>("id")
    .eq("is_sample", true)
    .eq("added_in_demo", false)
    .or(`state->>source_process_id.eq.${processId},source_proposal_id.eq.${processId}`);
  return rows.map((r) => r.id);
}

/** The state of one sample process, or null when there is no such sample process. */
export async function sampleProcessState(processId: string): Promise<{ state: Record<string, unknown> | null } | null> {
  return db()
    .from("processes")
    .select<{ state: Record<string, unknown> | null }>("state")
    .eq("id", processId)
    .eq("is_sample", true)
    .maybeSingle();
}

/** Replace one process's `state` (no event). */
export async function replaceProcessState(processId: string, state: Record<string, unknown>): Promise<void> {
  await db().from("processes").update({ state }).eq("id", processId);
}

/** Whether a process with this id exists on a named hub. */
export async function processExistsOnHub(hubId: string, processId: string): Promise<boolean> {
  const row = await forHub(hubId).from("processes").select<{ id: string }>("id").eq("id", processId).maybeSingle();
  return !!row;
}

/** Set a process's `created_at` on a named hub (the seed backdates its rows). */
export async function stampProcessCreatedAt(hubId: string, processId: string, iso: string): Promise<void> {
  await forHub(hubId).from("processes").update({ created_at: iso }).eq("id", processId);
}

/** A process's version on a named hub (throws when there is not exactly one row). */
export async function processVersionOnHub(hubId: string, processId: string): Promise<number> {
  const row = await forHub(hubId)
    .from("processes")
    .select<{ version: number | string }>("version")
    .eq("id", processId)
    .single();
  return Number(row.version);
}

// --- civic.review and civic.receipts ---

/** A process's type and title; HubDbError (PGRST116) when there is none. */
export async function readProcessTypeAndTitle(processId: string): Promise<{ type: string; title: string }> {
  return db().from("processes").select<{ type: string; title: string }>("type, title").eq("id", processId).single();
}

/** A process's type; HubDbError (PGRST116) when there is none. */
export async function readProcessType(processId: string): Promise<{ type: string }> {
  return db().from("processes").select<{ type: string }>("type").eq("id", processId).single();
}

/** The fields a review snapshots, with the type; HubDbError (PGRST116) when there is none. */
export async function readProcessForSnapshot(processId: string): Promise<{
  title: string;
  description: string;
  content?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  type: string;
}> {
  return db()
    .from("processes")
    .select<{
      title: string;
      description: string;
      content?: Record<string, unknown> | null;
      config?: Record<string, unknown> | null;
      type: string;
    }>("title, description, content, config, type")
    .eq("id", processId)
    .single();
}

/** Archive a process (status and updated_at only, no event). */
export async function archiveProcessRow(processId: string, updatedAt: string): Promise<void> {
  await db().from("processes").update({ status: "archived", updated_at: updatedAt }).eq("id", processId);
}

/** Set a process's status, nothing else (no event). */
export async function setProcessStatusRow(processId: string, status: string): Promise<void> {
  await db().from("processes").update({ status }).eq("id", processId);
}

/** The votes that are open or changed status after `since` (an ISO time), by id (paged past 1,000). */
export async function openOrRecentVoteIds(since: string): Promise<string[]> {
  const rows = await readAll((from, to) =>
    db()
      .from("processes")
      .select<{ id: string }>("id")
      .eq("type", "civic.vote")
      .or(`status.eq.active,updated_at.gte.${since}`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => r.id);
}

/** The archived votes with their state, by id (paged past 1,000). */
export async function archivedVotes(): Promise<Array<{ id: string; state: { voting_closes_at?: string | null } | null }>> {
  return readAll((from, to) =>
    db()
      .from("processes")
      .select<{ id: string; state: { voting_closes_at?: string | null } | null }>("id, state")
      .eq("type", "civic.vote")
      .eq("status", "archived")
      .order("id", { ascending: true })
      .range(from, to),
  );
}
