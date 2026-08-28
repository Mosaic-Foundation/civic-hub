// Process service — manages process lifecycle via the process registry.
//
// Process endpoints (/process) are INTERNAL control surfaces.
// Events are the primary public interface of the hub.
// All external systems should rely on events, not internal process APIs.
//
// Storage: Postgres (processes table).
// This service delegates all process-specific logic to registered handlers
// and owns: storage, ID generation, lifecycle events, and the dispatch loop.
//
// Known limitation (accepted for the pilot): concurrent actions on the same
// process can race, because executeAction() does "read state → mutate →
// write state". Under low concurrency this is fine. Hardening path:
//   - optimistic locking via updated_at compare-and-swap, or
//   - SELECT ... FOR UPDATE inside a Postgres RPC.

import {
  Process,
  CreateProcessInput,
  ProcessAction,
  ProcessContent,
  ProcessDefinition,
  ProcessStatus,
} from "../models/process.js";
import { emitEvent } from "../events/eventEmitter.js";
import { generateId } from "../utils/id.js";
import {
  getProcessHandler,
  setProcessFactory,
  setActionDispatcher,
} from "../processes/registry.js";
import {
  spawnBriefFromClosedProcess,
  findExistingBriefId,
} from "../processes/spawnBrief.js";
import { getDb } from "../db/client.js";
import {
  resolveInitialStatus,
  isPubliclyFetchable,
  isActionable,
  shouldEmitStatusUpdate,
  nonPublicStatusFilter,
  NON_PUBLIC_STATUSES,
} from "./processLifecycle.js";
import {
  resolveCreators,
  resolveCreator,
  getCreator,
} from "./creatorDisplay.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../config/hub.js";


// --- Row <-> model mapping -------------------------------------------------

export interface ProcessRow {
  id: string;
  type: string;
  process_version: string;
  title: string;
  description: string | null;
  jurisdiction: string | null;
  status: ProcessStatus;
  content: ProcessContent | null;
  state: Record<string, unknown>;
  hub_id: string | null;
  created_by: string | null;
  source_proposal_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToProcess(row: ProcessRow): Process {
  const definition: ProcessDefinition = {
    type: row.type,
    version: row.process_version,
  };

  const proc: Process = {
    id: row.id,
    definition,
    title: row.title,
    description: row.description ?? "",
    status: row.status,
    hubId: row.hub_id ?? HUB_ID,
    jurisdiction: row.jurisdiction ?? DEFAULT_JURISDICTION,
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: row.state ?? {},
  };

  if (row.content) proc.content = row.content;
  return proc;
}

// --- Create ----------------------------------------------------------------

export async function createProcess(
  input: CreateProcessInput,
): Promise<Process> {
  const handler = getProcessHandler(input.definition.type);
  if (!handler) {
    throw new Error(`Unsupported process type: ${input.definition.type}`);
  }

  const id = input.id ?? generateId("proc");
  const initialState = handler.initializeState(input.state ?? {});

  // Use the state's status if the handler sets one (e.g. civic.vote → "draft").
  // Handlers that don't declare a resting status (announcements, vote-results,
  // deliberations) are created live, so default to "active".
  const stateStatus = (initialState as Record<string, unknown>).status as
    | ProcessStatus
    | undefined;
  const status: ProcessStatus = resolveInitialStatus(stateStatus);

  const hubId = input.hubId ?? HUB_ID;
  const jurisdiction = input.jurisdiction ?? DEFAULT_JURISDICTION;

  const row: Partial<ProcessRow> & { id: string } = {
    id,
    type: input.definition.type,
    process_version: input.definition.version,
    title: input.title,
    description: input.description,
    jurisdiction,
    status,
    content: input.content ?? null,
    state: initialState,
    hub_id: hubId,
    created_by: input.createdBy,
    source_proposal_id:
      ((input.state ?? {}) as Record<string, unknown>).source_proposal_id as
        | string
        | undefined ?? null,
  };

  const { data, error } = await getDb()
    .from("processes")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`ProcessService: failed to insert process: ${error.message}`);
  }

  const process = rowToProcess(data as ProcessRow);

  console.log(
    `[process] created ${process.definition.type} "${process.title}" (${id})`,
  );

  // Emit creation event. If this throws, the process row exists without a
  // creation event — acceptable edge case (caller sees an error; process can
  // be deleted or an event emitted manually during cleanup).
  await emitEvent({
    event_type: "civic.process.created",
    actor: input.createdBy,
    process_id: id,
    hub_id: process.hubId,
    jurisdiction: process.jurisdiction,
    data: {
      process: {
        type: input.definition.type,
        title: input.title,
      },
    },
    // Sync paths pass eventTimestamp = real-world publication time so the
    // feed orders synced items chronologically. Hand-authored callers omit
    // it and the emitter stamps `now`.
    timestamp: input.eventTimestamp,
  });

  return process;
}

// Inject createProcess into the registry so handlers (e.g. civic.vote spawning
// a civic.vote_results record on close) can create processes without circular
// imports.
setProcessFactory(createProcess);

// Inject the action dispatcher so handlers can run their own close action
// (lazy deadline-close) through the normal persisted-action path without a
// circular import back into this module.
setActionDispatcher(executeAction);

// --- Read ------------------------------------------------------------------

export async function getProcess(id: string): Promise<Process | undefined> {
  const { data, error } = await getDb()
    .from("processes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`ProcessService: ${error.message}`);
  if (!data) return undefined;
  return rowToProcess(data as ProcessRow);
}

/**
 * All public processes — optionally narrowed to specific process TYPES,
 * in SQL. Pass `types` whenever the caller only wants one kind: the
 * processes table carries every process's full state JSONB (vote
 * tallies, brief content, …), so "fetch everything and filter in JS"
 * ships the whole table over the wire to render a handful of summaries
 * (the Conversations tab was pulling all 144 rows to show 5 — perf
 * pass, 2026-08-28).
 */
export async function getAllProcesses(types?: string[]): Promise<Process[]> {
  let q = getDb()
    .from("processes")
    .select("*")
    .not("status", "in", nonPublicStatusFilter());
  if (types && types.length > 0) {
    q = q.in("type", types);
  }
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`ProcessService: ${error.message}`);
  return (data ?? []).map((r) => rowToProcess(r as ProcessRow));
}

// --- Action dispatch -------------------------------------------------------

export async function executeAction(
  processId: string,
  action: ProcessAction,
): Promise<{ process: Process; result: Record<string, unknown> }> {
  const process = await getProcess(processId);
  if (!process) {
    throw new Error(`Process not found: ${processId}`);
  }

  if (!isActionable(process.status)) {
    throw new Error(
      `Process ${processId} is finalized and cannot accept actions`,
    );
  }

  const handler = getProcessHandler(process.definition.type);
  if (!handler) {
    throw new Error(`Unsupported process type: ${process.definition.type}`);
  }

  const previousStatus = process.status;

  console.log(`[action] ${action.type} on ${processId} by ${action.actor}`);

  // Handler mutates process.state (and optionally process.status) in place,
  // then returns a result payload. It may also emit action-specific events.
  const result = await handler.handleAction(process, action);

  // Persist the mutated process back.
  const now = new Date().toISOString();
  const { error: updErr } = await getDb()
    .from("processes")
    .update({
      status: process.status,
      state: process.state,
      updated_at: now,
    })
    .eq("id", process.id);

  if (updErr) {
    throw new Error(
      `ProcessService: failed to persist action result: ${updErr.message}`,
    );
  }
  process.updatedAt = now;

  // Emit process.updated only when a meaningful state change occurred.
  if (shouldEmitStatusUpdate(previousStatus, process.status)) {
    await emitEvent({
      event_type: "civic.process.updated",
      actor: action.actor,
      process_id: process.id,
      hub_id: process.hubId,
      jurisdiction: process.jurisdiction,
      processType: process.definition.type,
      data: {
        process: {
          previous_status: previousStatus,
          status: process.status,
        },
      },
    });
  }

  // Universal brief seam: when a process transitions INTO a terminal state,
  // spawn its Civic Brief (pending admin review) if its handler produces one.
  // A no-op for types without generateBrief (e.g. votes, which keep their
  // own civic.vote_results pipeline). Best-effort + idempotent: a failure
  // here must never wedge the close, and a double-close spawns only one
  // brief (findExistingBriefId collapses the common window).
  const enteredTerminal =
    !isTerminalStatus(previousStatus) && isTerminalStatus(process.status);
  if (enteredTerminal && handler.generateBrief) {
    try {
      const existing = await findExistingBriefId(process.id);
      if (!existing) {
        await spawnBriefFromClosedProcess(process, action.actor);
      }
    } catch (err) {
      console.warn(
        `[brief] spawn on close of ${process.id} failed (close proceeds):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { process, result };
}

/** A process is terminal once closed or finalized — the moment its brief
 *  should be generated. */
function isTerminalStatus(status: string): boolean {
  return status === "closed" || status === "finalized";
}

// --- Lazy deadline-close ---------------------------------------------------

/**
 * One type-agnostic lazy close. For ANY process whose deadline has elapsed and
 * is still open, the registered handler's `closeIfExpired` performs the terminal
 * transition (persist + emit) and returns the updated process. Handlers own
 * their own deadline source and close action (vote → voting_closes_at; polis
 * deliberation → deadline; proposal → proposals.closes_at); types without a
 * deadline (projects) omit the hook and are returned unchanged.
 *
 * Called from the read paths so the UI always sees the correct state without a
 * cron. Best-effort: a close failure (e.g. a race, or the Polis backend being
 * down) is logged and the original process is returned so the read still works.
 */
async function autoCloseIfExpired(process: Process): Promise<Process> {
  const handler = getProcessHandler(process.definition.type);
  if (!handler?.closeIfExpired) return process;

  try {
    return await handler.closeIfExpired(process);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.warn(
      `[auto-close] Failed to close ${process.definition.type} ${process.id}: ${msg}`,
    );
    return process;
  }
}

// --- UI read layer ---------------------------------------------------------

export async function listProcessSummaries(
  types?: string[],
): Promise<Record<string, unknown>[]> {
  const all = await getAllProcesses(types);
  // Lazily close any process whose deadline has elapsed before summarizing.
  const resolved = await Promise.all(all.map(autoCloseIfExpired));
  const summaries = resolved.map((p) => {
    const handler = getProcessHandler(p.definition.type);
    if (handler) return handler.getSummary(p);
    return {
      id: p.id,
      type: p.definition.type,
      title: p.title,
      status: p.status,
      created_at: p.createdAt,
      created_by: p.createdBy,
    };
  });

  // Resolve every creator id in ONE query, then attach the human-facing
  // attribution (name + admin flag) and redact the raw id from this
  // public list. Summaries carry `created_by`; some types instead expose
  // an author id — those are enriched inside their own read models.
  const map = await resolveCreators(
    summaries.map((s) =>
      typeof (s as { created_by?: unknown }).created_by === "string"
        ? ((s as { created_by: string }).created_by)
        : "",
    ),
  );
  return summaries.map((s) => {
    const rawId =
      typeof (s as { created_by?: unknown }).created_by === "string"
        ? ((s as { created_by: string }).created_by)
        : "";
    const creator = getCreator(map, rawId);
    return {
      ...s,
      creator_name: creator.name,
      creator_is_admin: creator.is_admin,
      creator_official_type: creator.official?.type ?? null,
      creator_official_title: creator.official?.title ?? null,
      created_by: "",
    };
  });
}

export async function getProcessState(
  processId: string,
  actor?: string,
): Promise<Record<string, unknown> | undefined> {
  let process = await getProcess(processId);
  if (!process) return undefined;

  // Lifecycle gate: the canonical processes-row status is the single source of
  // truth for what's publicly fetchable. Processes still under review, or
  // soft-deleted/archived (declined, withdrawn, archived projects/proposals),
  // are not addressable by direct id — they're admin- or owner-facing only and
  // surface through their own queues. This also avoids leaking the
  // pending_review/internal-status mismatch via this read path.
  if (!isPubliclyFetchable(process.status)) {
    return undefined;
  }

  // Lazily close the process if its deadline has elapsed.
  process = await autoCloseIfExpired(process);

  const handler = getProcessHandler(process.definition.type);
  const model = handler
    ? await handler.getReadModel(process, actor)
    : {
        id: process.id,
        type: process.definition.type,
        title: process.title,
        status: process.status,
        created_at: process.createdAt,
        created_by: process.createdBy,
      };

  // Attach human-facing creator attribution and redact the raw id from this
  // public read model. Read models expose the creator id under `created_by`
  // (vote, project, proposal, generic) — types that use a different field
  // (announcement → author_id) enrich inside their own read model instead.
  return enrichProcessCreator(model);
}

/**
 * Attach `creator_name` + `creator_is_admin` + the official title fields
 * to a process read model and
 * redact the raw `created_by` id. Shared by the single-process read path.
 * Idempotent-friendly: if the model has no `created_by`, resolves to the
 * "Resident" fallback and leaves the (already absent) id blank.
 */
async function enrichProcessCreator(
  model: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rawId =
    typeof model.created_by === "string" ? (model.created_by as string) : "";
  const creator = await resolveCreator(rawId);
  return {
    ...model,
    creator_name: creator.name,
    creator_is_admin: creator.is_admin,
    creator_official_type: creator.official?.type ?? null,
    creator_official_title: creator.official?.title ?? null,
    created_by: "",
  };
}

// --- Dev/test utilities ----------------------------------------------------

/** Clear all processes — dev/seed only. */
/**
 * Persist the current in-memory Process back to storage. Used by flows
 * that mutate a process outside of the action dispatcher — for example,
 * the admin brief approval orchestration, which mutates the brief and
 * the linked vote directly via module functions (not HTTP actions).
 *
 * Updates status, state, and updated_at. Does NOT emit any events —
 * callers that cause status transitions are responsible for emitting
 * the corresponding lifecycle events themselves.
 */
export async function saveProcessState(process: Process): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getDb()
    .from("processes")
    .update({
      status: process.status,
      state: process.state,
      updated_at: now,
    })
    .eq("id", process.id);
  if (error) {
    throw new Error(
      `ProcessService: failed to save process ${process.id}: ${error.message}`,
    );
  }
  process.updatedAt = now;
}

// --- Archive / restore (soft-remove) ---------------------------------------
//
// Soft-remove for admin cleanup (old BoS meeting summaries, stale content).
// We do NOT hard-delete: process content is append-only-ish (reviewed
// processes carry immutable review_turns) and residents may have engaged with
// it. Archiving flips the canonical status to "archived" — which already
// removes the item from the public list + direct-fetch (NON_PUBLIC_STATUSES)
// AND, paired with the events feed-status filter, from the feed/digest so no
// ghost cards remain. The prior status + reason live in `state.archive` so a
// restore puts the item back exactly where it was (a published meeting summary
// returns to "published", a closed vote to "closed"). Mirrors the existing
// announcement `state.moderation` soft-remove pattern — no schema change.

interface ArchiveMeta {
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  reason: string | null;
  /** The status the process held before it was archived, for restore. */
  previous_status: ProcessStatus | null;
  restored_at?: string | null;
}

export const ARCHIVE_REASON_MAX = 500;

export async function archiveProcess(
  id: string,
  adminId: string,
  reason: string,
): Promise<Process> {
  const process = await getProcess(id);
  if (!process) throw new Error(`Process not found: ${id}`);

  const trimmedReason = (reason ?? "").trim();
  if (!trimmedReason) {
    throw new Error("An archive reason is required");
  }
  if (trimmedReason.length > ARCHIVE_REASON_MAX) {
    throw new Error(
      `Archive reason must be ${ARCHIVE_REASON_MAX} characters or fewer`,
    );
  }

  // Idempotent — re-archiving an archived process is a no-op.
  if (process.status === "archived") return process;

  const now = new Date().toISOString();
  const archive: ArchiveMeta = {
    archived: true,
    archived_at: now,
    archived_by: adminId,
    reason: trimmedReason,
    previous_status: process.status,
    restored_at: null,
  };
  const nextState = { ...(process.state ?? {}), archive };

  const { error } = await getDb()
    .from("processes")
    .update({ status: "archived", state: nextState, updated_at: now })
    .eq("id", id);
  if (error) {
    throw new Error(`ProcessService: failed to archive ${id}: ${error.message}`);
  }

  // Restricted-visibility lifecycle event so the moderation log picks it up
  // (mirrors the announcement remove/restore emit shape) and the public feed
  // never surfaces it.
  await emitEvent({
    event_type: "civic.process.updated",
    actor: adminId,
    process_id: id,
    hub_id: process.hubId || HUB_ID,
    jurisdiction: process.jurisdiction || DEFAULT_JURISDICTION,
    processType: process.definition.type,
    visibility: "restricted",
    data: {
      process: { previous_status: archive.previous_status, status: "archived" },
      moderation: {
        action: "process_archived",
        reason: trimmedReason,
        archived_by: adminId,
      },
    },
  });

  process.status = "archived";
  process.state = nextState;
  process.updatedAt = now;

  // Let the handler sync storage it owns (a child table's status column, a
  // status kept inside state). Best-effort by design — see ProcessHandler
  // .onArchive: a stale child row is recoverable, an admin who cannot take
  // down bad content is not.
  const handler = getProcessHandler(process.definition.type);
  if (handler?.onArchive) {
    try {
      await handler.onArchive(process);
    } catch (err) {
      console.error(
        `[archive] ${process.definition.type} onArchive failed for ${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return process;
}

export async function restoreProcess(
  id: string,
  adminId: string,
): Promise<Process> {
  const process = await getProcess(id);
  if (!process) throw new Error(`Process not found: ${id}`);
  if (process.status !== "archived") return process;

  const archive = (process.state?.archive ?? null) as ArchiveMeta | null;
  // Fall back to "closed" if we somehow lost the prior status — a safe,
  // non-live resting state that won't re-open a vote or expose a draft.
  const restoreStatus: ProcessStatus = archive?.previous_status ?? "closed";

  const now = new Date().toISOString();
  const nextState = { ...(process.state ?? {}) };
  // Captured BEFORE the delete: a handler's onRestore may have stashed its
  // child row's previous status in here, and it is about to be removed from
  // both the row and the in-memory copy.
  const archiveMeta =
    ((process.state ?? {}) as Record<string, unknown>).archive as
      | Record<string, unknown>
      | undefined;
  delete (nextState as Record<string, unknown>).archive;

  const { error } = await getDb()
    .from("processes")
    .update({ status: restoreStatus, state: nextState, updated_at: now })
    .eq("id", id);
  if (error) {
    throw new Error(`ProcessService: failed to restore ${id}: ${error.message}`);
  }

  await emitEvent({
    event_type: "civic.process.updated",
    actor: adminId,
    process_id: id,
    hub_id: process.hubId || HUB_ID,
    jurisdiction: process.jurisdiction || DEFAULT_JURISDICTION,
    processType: process.definition.type,
    visibility: "restricted",
    data: {
      process: { previous_status: "archived", status: restoreStatus },
      moderation: { action: "process_restored", restored_by: adminId },
    },
  });

  process.status = restoreStatus;
  process.state = nextState;
  process.updatedAt = now;

  // Mirror of the archive hook. previousStatus is passed so a handler can put
  // its child row back where it was rather than guessing a default.
  const restoreHandler = getProcessHandler(process.definition.type);
  if (restoreHandler?.onRestore) {
    try {
      await restoreHandler.onRestore(process, restoreStatus, archiveMeta ?? null);
    } catch (err) {
      console.error(
        `[restore] ${process.definition.type} onRestore failed for ${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return process;
}

/**
 * The set of process ids that are NOT publicly visible (archived or still
 * pending review). Used by the events feed + digest to suppress cards for
 * content that has been archived/removed — otherwise an archived process's
 * historical `civic.process.created` / `.started` / proposal-submitted events
 * linger in `/events` forever and render ghost feed posts. Single small query;
 * the feed already fetches all events, so this is one extra round-trip.
 */
export async function getNonPublicProcessIds(): Promise<Set<string>> {
  const { data, error } = await getDb()
    .from("processes")
    .select("id")
    .in("status", [...NON_PUBLIC_STATUSES]);
  if (error) throw new Error(`ProcessService: ${error.message}`);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}


/**
 * All archived processes, newest first — for the admin Archived view where an
 * admin can review and restore. Bypasses the public NON_PUBLIC_STATUSES filter
 * by design (admin-only surface).
 */
export async function getArchivedProcesses(): Promise<Process[]> {
  const { data, error } = await getDb()
    .from("processes")
    .select("*")
    .eq("status", "archived")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`ProcessService: ${error.message}`);
  return (data ?? []).map((r) => rowToProcess(r as ProcessRow));
}

/*
 * deleteProcess was REMOVED on 2026-08-26.
 *
 * It hard-deleted a `processes` row (and its events) while `proposals` and
 * `projects` have NO foreign key back to `processes` — so it silently orphaned
 * child rows, leaving a proposal that no process owns. Nothing in the app
 * called it; only a dev verification script did, and that script now cleans up
 * its own throwaway ids directly.
 *
 * Archiving is the supported removal path. It is reversible, it is visible in
 * the Archived tab and the moderation log, and it syncs child storage through
 * ProcessHandler.onArchive. If a hard delete is ever genuinely needed, add the
 * foreign keys first so the database enforces the cleanup, rather than trusting
 * a helper to remember every table.
 */

/**
 * Delete events whose process_id doesn't match any existing process.
 * Returns the count of orphaned events removed.
 */
export async function cleanOrphanedEvents(): Promise<number> {
  const { data: processes } = await getDb()
    .from("processes")
    .select("id");
  const validIds = new Set((processes ?? []).map((p: { id: string }) => p.id));

  const { data: events } = await getDb()
    .from("events")
    .select("id, process_id");
  if (!events || events.length === 0) return 0;

  const orphanIds = (events as Array<{ id: string; process_id: string }>)
    .filter((e) => !validIds.has(e.process_id))
    .map((e) => e.id);
  if (orphanIds.length === 0) return 0;

  const { error } = await getDb()
    .from("events")
    .delete()
    .in("id", orphanIds);
  if (error) {
    throw new Error(`Failed to clean orphaned events: ${error.message}`);
  }
  return orphanIds.length;
}

export async function clearProcesses(): Promise<void> {
  const { error } = await getDb().from("processes").delete().neq("id", "");
  if (error) {
    throw new Error(`ProcessService: failed to clear processes: ${error.message}`);
  }
}
