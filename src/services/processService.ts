// Process service — manages process lifecycle via the process registry.
//
// Process endpoints (/process) are INTERNAL control surfaces.
// Events are the primary public interface of the hub.
// All external systems should rely on events, not internal process APIs.
//
// Storage: Postgres (processes table), through forHub(): every read, write
// and lifecycle event is confined to the hub in scope (Phase 2a), so one
// hub's feed, process list or action never reaches another hub's process.
// This service delegates all process-specific logic to registered handlers
// and owns: storage, ID generation, lifecycle events, and the dispatch loop.
//
// Concurrency (Audit 3, 2026-10-11): executeAction reads the process, runs
// the handler, and writes the new status, state and the handler's events in
// one transaction that is refused if the row's version moved in between
// (transition_process). A refused action that its handler declares retry-safe
// runs again on a fresh read; any other is refused with a 409. So two writes
// never overwrite each other, and a close that loses a race writes nothing.

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors/index.js";
import { transitionProcess, ProcessChangedError } from "../db/atomic.js";
import { runInActionScope } from "./actionScope.js";
import { appendEvent } from "../events/eventStore.js";
import { assertProcessTypeEnabled, disabledProcessTypes, isProcessTypeEnabled } from "./pluginGate.js";
import {
  Process,
  CreateProcessInput,
  ProcessAction,
  ProcessContent,
  ProcessDefinition,
  ProcessStatus,
} from "../models/process.js";
import { buildEvent, emitEvent } from "../events/eventEmitter.js";
import { generateId } from "../utils/id.js";
import {
  getProcessHandler,
  setProcessFactory,
  setActionDispatcher,
  setDeadlineCloser,
  PROCESS_TYPE_PLUGINS,
} from "../processes/registry.js";
import {
  spawnBriefFromClosedProcess,
  findExistingBriefId,
} from "../processes/spawnBrief.js";
import { forHub, type HubDb } from "../db/forHub.js";
import type { ActionCaller } from "../processes/types.js";
import { currentHubId } from "../config/hubContext.js";
import {
  resolveInitialStatus,
  isPubliclyFetchable,
  isActionable,
  shouldEmitStatusUpdate,
  nonPublicStatusFilter,
  NON_PUBLIC_STATUSES,
  LIVE_STATUSES,
} from "./processLifecycle.js";
import {
  resolveCreators,
  resolveCreator,
  getCreator,
  redactForAudience,
  type Audience,
} from "./creatorDisplay.js";
import { defaultJurisdiction } from "../config/hub.js";
import type { PluginId } from "../models/hubSettings.js";
import { readAll } from "../db/readAll.js";

/** The hub in scope. Processes are only ever read or written inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}


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
  hub_id: string;
  created_by: string | null;
  source_proposal_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  version?: number | string;
  is_sample?: boolean;
  added_in_demo?: boolean;
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
    hubId: row.hub_id,
    jurisdiction: row.jurisdiction ?? defaultJurisdiction(),
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: row.state ?? {},
  };
  if (row.version !== undefined && row.version !== null) proc.version = Number(row.version);

  if (row.content) proc.content = row.content;
  // A visitor's submission on a demo hub is stored as sample content (out of
  // /events, removed with the samples) but is not one of the samples: no
  // badge, not illustrative (20261007000000_added_in_demo).
  if (row.is_sample && !row.added_in_demo) proc.isSample = true;
  if (row.added_in_demo) proc.addedInDemo = true;
  return proc;
}

// --- Create ----------------------------------------------------------------

export async function createProcess(
  input: CreateProcessInput,
): Promise<Process> {
  const handler = getProcessHandler(input.definition.type);
  if (!handler) {
    throw new ValidationError("That kind of process isn't supported on this hub.", "unsupported_process_type");
  }
  // A hub that switched this type's plugin off cannot create one, by any path.
  assertProcessTypeEnabled(input.definition.type);

  const id = input.id ?? generateId("proc");
  const initialState = handler.initializeState(input.state ?? {});

  // Use the state's status if the handler sets one (e.g. civic.vote → "draft").
  // Handlers that don't declare a resting status (announcements, vote-results,
  // deliberations) are created live, so default to "active".
  const stateStatus = (initialState as Record<string, unknown>).status as
    | ProcessStatus
    | undefined;
  const status: ProcessStatus = resolveInitialStatus(stateStatus);

  const jurisdiction = input.jurisdiction ?? defaultJurisdiction();

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
    created_by: input.createdBy,
    source_proposal_id:
      ((input.state ?? {}) as Record<string, unknown>).source_proposal_id as
        | string
        | undefined ?? null,
    // Only the sample seed sets it; a spawn from a sample process inherits
    // it in the database (processes_inherit_sample).
    ...(input.isSample ? { is_sample: true } : {}),
  };

  const data = await db()
    .from("processes")
    .insert(row)
    .select<ProcessRow>()
    .single();

  const process = rowToProcess(data);

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
// circular import back into this module. It acts as the hub itself.
setActionDispatcher((processId, action) => executeAction(processId, action, "system"));
setDeadlineCloser((process, action) => closeAtDeadline(process, action));

// --- Read ------------------------------------------------------------------

export async function getProcess(id: string): Promise<Process | undefined> {
  const data = await db()
    .from("processes")
    .select<ProcessRow>("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return undefined;
  return rowToProcess(data);
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
/**
 * getProcess, or null when the process's plugin is switched off on the hub in
 * scope: for the routes under a process's id that answer as if it were not
 * there (input, edit, links, share). See src/services/pluginGate.ts.
 */
export async function getEnabledProcess(id: string): Promise<Process | null> {
  const process = await getProcess(id);
  return process && isProcessTypeEnabled(process.definition.type) ? process : null;
}

export async function getAllProcesses(types?: string[]): Promise<Process[]> {
  // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
  const data = await readAll((from, to) => {
    let q = db()
      .from("processes")
      .select<ProcessRow>("*")
      .not("status", "in", nonPublicStatusFilter());
    if (types && types.length > 0) {
      q = q.in("type", types);
    }
    return q
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });
  return data.map((r) => rowToProcess(r));
}

// --- Action dispatch -------------------------------------------------------

/** A resident called an action their handler does not open to residents. */
export class ActionNotAllowedError extends ForbiddenError {
  constructor(readonly actionType: string) {
    super("Admin access required for this action", "admin_required");
  }
}

/** How many times a retry-safe action runs before a conflict is refused. */
const MAX_ACTION_ATTEMPTS = 8;

export async function executeAction(
  processId: string,
  action: ProcessAction,
  caller: ActionCaller,
): Promise<{ process: Process; result: Record<string, unknown> }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptAction(processId, action, caller);
    } catch (err) {
      if (!(err instanceof ProcessChangedError) || attempt >= MAX_ACTION_ATTEMPTS) throw err;
      const handler = await handlerFor(processId);
      if (!handler?.retrySafeActions?.includes(action.type)) throw err;
      // Another write won; read again and redo the action on top of it. A
      // short random wait spreads out a burst (endorsements at a meeting).
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * attempt));
    }
  }
}

async function handlerFor(processId: string) {
  const process = await getProcess(processId);
  return process ? getProcessHandler(process.definition.type) : undefined;
}

/** Status and state as one comparable string: "did the handler change the row?" */
function rowImage(process: Process): string {
  return JSON.stringify({ status: process.status, state: process.state });
}

async function attemptAction(
  processId: string,
  action: ProcessAction,
  caller: ActionCaller,
): Promise<{ process: Process; result: Record<string, unknown> }> {
  const process = await getProcess(processId);
  if (!process) {
    throw new NotFoundError("Process not found");
  }

  const handler = getProcessHandler(process.definition.type);
  if (!handler) {
    throw new Error(`Unsupported process type: ${process.definition.type}`);
  }

  // Residents may call only what the handler opens to them; everything else
  // is an admin's or the hub's. Checked before the status, so a refused
  // caller learns nothing about where the process is in its lifecycle.
  if (caller === "resident" && !handler.residentActions.includes(action.type)) {
    throw new ActionNotAllowedError(action.type);
  }

  if (!isActionable(process.status)) {
    throw new ConflictError("This is finished and can't take any more actions.", "process_finalized");
  }

  const previousStatus = process.status;
  const before = rowImage(process);

  console.log(`[action] ${action.type} on ${processId} by ${action.actor}`);

  // Handler mutates process.state (and optionally process.status) in place,
  // then returns a result payload. The events it emits about this process
  // are held (actionScope) and written below with the state, or not at all.
  const { value: result, events, afterCommit } = await runInActionScope(
    process.id,
    () => handler.handleAction(process, action),
  );

  if (rowImage(process) !== before) {
    // One transaction: the new status and state, the handler's events, and a
    // status change's process.updated event. Refused if the row's status or
    // version moved since the read above, so nothing is overwritten and a
    // losing close publishes nothing.
    const statusEvent = shouldEmitStatusUpdate(previousStatus, process.status)
      ? buildEvent({
          event_type: "civic.process.updated",
          actor: action.actor,
          process_id: process.id,
          jurisdiction: process.jurisdiction,
          processType: process.definition.type,
          data: {
            process: {
              previous_status: previousStatus,
              status: process.status,
            },
          },
          timestamp: action.at,
        })
      : null;
    const out = await transitionProcess({
      hubId: currentHubId(),
      processId: process.id,
      toStatus: process.status,
      actor: action.actor,
      event: statusEvent,
      state: process.state,
      expectedStatus: previousStatus,
      expectedVersion: process.version,
      events,
    });
    process.updatedAt = out.updated_at;
    process.version = out.version;
  } else {
    // Nothing on the process row changed (a ballot, a word-cloud entry: their
    // rows are elsewhere): its events are written as they were, unconditioned.
    for (const event of events) {
      await appendEvent(event);
      console.log(`[event] ${event.event_type} by ${event.actor} (${event.id})`);
    }
  }

  for (const fn of afterCommit) await fn();

  // Universal brief seam: when a process transitions INTO a terminal state,
  // spawn its Civic Brief (pending admin review) if its handler produces one.
  // A no-op for types without generateBrief. Only the action whose write won
  // gets here, and the spawn is insert-or-skip on a unique index, so a
  // process has one brief. Best-effort: a failure must never wedge the close.
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
    // The row as it is now: another reader's close may have won.
    return (await getProcess(process.id).catch(() => undefined)) ?? process;
  }
}

/** How long one reader's claim on a deadline close holds off the others. */
const CLOSE_CLAIM_MS = 2 * 60 * 1000;

/**
 * A deadline close, run once however many readers notice the deadline at
 * the same moment (Audit 3). A reader first claims the close on the row
 * (`close_claimed_until`, a conditional update: one wins); the others return
 * the process as it is, so a conversation's summary is written once and not
 * by every page load during the seconds it takes. The claim lapses after
 * CLOSE_CLAIM_MS, so a close that failed is tried again by a later read or
 * the hourly job. The close itself is an ordinary action, refused if anything
 * else wrote the row first; a refusal after another close won returns the
 * closed process, not an error.
 */
async function closeAtDeadline(process: Process, action: ProcessAction): Promise<Process> {
  const now = new Date();
  const claimed = await db()
    .from("processes")
    .update({ close_claimed_until: new Date(now.getTime() + CLOSE_CLAIM_MS).toISOString() })
    .eq("id", process.id)
    .eq("status", process.status)
    .or(`close_claimed_until.is.null,close_claimed_until.lt.${now.toISOString()}`)
    .select<{ id: string }>("id");
  if (claimed.length === 0) return (await getProcess(process.id)) ?? process;
  try {
    return (await executeAction(process.id, action, "system")).process;
  } catch (err) {
    const current = await getProcess(process.id);
    if (current && current.status !== process.status) return current;
    throw err;
  }
}

/**
 * The hourly deadline close (job `vote_close`): every active process of
 * `type` in the hub in scope whose deadline has passed is closed now, through
 * its handler's closeIfExpired — the same close a read would run, stamped
 * with the deadline. Unlike the read path, a failure is reported, not
 * swallowed, so the job's run says which ones did not close.
 */
export async function closeExpiredProcesses(
  type: string,
): Promise<{ checked: number; closed: string[]; failed: Array<{ id: string; error: string }> }> {
  const handler = getProcessHandler(type);
  const closed: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  if (!handler?.closeIfExpired) return { checked: 0, closed, failed };
  const active = (await getAllProcesses([type])).filter((p) => p.status === "active");
  for (const p of active) {
    try {
      const after = await handler.closeIfExpired(p);
      if (after.status !== p.status) closed.push(p.id);
    } catch (err) {
      failed.push({ id: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { checked: active.length, closed, failed };
}

// --- UI read layer ---------------------------------------------------------

export async function listProcessSummaries(
  types: string[] | undefined,
  audience: Audience,
): Promise<Record<string, unknown>[]> {
  const all = (await getAllProcesses(types)).filter((p) =>
    isProcessTypeEnabled(p.definition.type),
  );
  // Lazily close any process whose deadline has elapsed before summarizing.
  const resolved = await Promise.all(all.map(autoCloseIfExpired));
  const summaries = resolved.map((p) => {
    const handler = getProcessHandler(p.definition.type);
    const summary = handler
      ? handler.getSummary(p)
      : {
          id: p.id,
          type: p.definition.type,
          title: p.title,
          status: p.status,
          created_at: p.createdAt,
          created_by: p.createdBy,
        };
    // Universal, not per handler: every type's card shows the Sample badge.
    return p.isSample ? { ...summary, is_sample: true } : summary;
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
    // List surface: no per-process numbering (a number is meaningless
    // when every row is a different process). Admin-authored rows show
    // "Admin"; officials their name; residents plain "Resident".
    const creator = redactForAudience(getCreator(map, rawId), rawId, {
      audience,
    });
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

export interface ProcessStateOptions {
  actor?: string;
  audience: Audience;
  /** Per-process resident numbering, when the caller built one (public detail reads). */
  anonNumbers?: Map<string, number>;
}

export async function getProcessState(
  processId: string,
  opts: ProcessStateOptions,
): Promise<Record<string, unknown> | undefined> {
  const actor = opts.actor;
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
  // A type whose plugin this hub switched off is not addressable either. The
  // row is untouched; turning the plugin back on makes it reachable again.
  if (!isProcessTypeEnabled(process.definition.type)) {
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
  const enriched = await enrichProcessCreator(model, opts);
  // Universal: every type's page shows the Sample badge (Phase 7).
  if (process.isSample) enriched.is_sample = true;
  return enriched;
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
  opts: ProcessStateOptions,
): Promise<Record<string, unknown>> {
  const rawId =
    typeof model.created_by === "string" ? (model.created_by as string) : "";
  const creator = redactForAudience(await resolveCreator(rawId), rawId, {
    audience: opts.audience,
    anonNumbers: opts.anonNumbers,
  });
  const out: Record<string, unknown> = {
    ...model,
    creator_name: creator.name,
    creator_is_admin: creator.is_admin,
    creator_official_type: creator.official?.type ?? null,
    creator_official_title: creator.official?.title ?? null,
    created_by: "",
  };
  // Snapshot byline fields (announcement-shaped models) must match the
  // audience rule too — a post-time snapshot is still a real name. Only
  // rewritten when the model's stamped official_type is null (legacy
  // officials keep their name via the stamp).
  if (
    opts.audience === "public" &&
    !creator.official &&
    (out.official_type ?? null) === null &&
    typeof out.author_display_name === "string" &&
    (out.author_display_name as string).length > 0
  ) {
    out.author_display_name = creator.name;
  }
  return out;
}

// --- Dev/test utilities ----------------------------------------------------

/**
 * The ids of this hub's sample processes (Phase 7), any status. For readers
 * that mark or leave out sample content by process: the feed's badge, the
 * admin digest.
 */
export async function getSampleProcessIds(): Promise<Set<string>> {
  const rows = await db()
    .from("processes")
    .select<{ id: string }>("id")
    .eq("is_sample", true)
    // A visitor's demo submission is stored as sample but shows no badge.
    .eq("added_in_demo", false);
  return new Set(rows.map((r) => r.id));
}

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
  let q = db()
    .from("processes")
    .update({
      status: process.status,
      state: process.state,
      updated_at: now,
    })
    .eq("id", process.id);
  // Read from a row: refused, not overwritten, if someone wrote since.
  if (typeof process.version === "number") q = q.eq("version", process.version);
  const rows = await q.select<{ version: number | string; updated_at: string }>("version, updated_at");
  if (rows.length === 0) {
    if (typeof process.version === "number") {
      throw new ProcessChangedError(`version ${process.version}`);
    }
    return;
  }
  process.updatedAt = rows[0].updated_at;
  process.version = Number(rows[0].version);
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
  if (!process) throw new NotFoundError("Process not found");

  const trimmedReason = (reason ?? "").trim();
  if (!trimmedReason) {
    throw new ValidationError("An archive reason is required");
  }
  if (trimmedReason.length > ARCHIVE_REASON_MAX) {
    throw new ValidationError(`Archive reason must be ${ARCHIVE_REASON_MAX} characters or fewer`);
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

  // The status change and its restricted-visibility lifecycle event (so the
  // moderation log picks it up and the public feed never surfaces it) are one
  // transaction.
  const archivedAt = await transitionProcess({
    hubId: currentHubId(),
    processId: id,
    toStatus: "archived",
    actor: adminId,
    state: nextState,
    expectedStatus: process.status,
    expectedVersion: process.version,
    event: buildEvent({
      event_type: "civic.process.updated",
      actor: adminId,
      process_id: id,
      jurisdiction: process.jurisdiction || defaultJurisdiction(),
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
    }),
  });

  process.status = "archived";
  process.state = nextState;
  process.updatedAt = archivedAt.updated_at;
  process.version = archivedAt.version;

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
  if (!process) throw new NotFoundError("Process not found");
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

  const restoredAt = await transitionProcess({
    hubId: currentHubId(),
    processId: id,
    toStatus: restoreStatus,
    actor: adminId,
    state: nextState,
    expectedStatus: "archived",
    expectedVersion: process.version,
    event: buildEvent({
      event_type: "civic.process.updated",
      actor: adminId,
      process_id: id,
      jurisdiction: process.jurisdiction || defaultJurisdiction(),
      processType: process.definition.type,
      visibility: "restricted",
      data: {
        process: { previous_status: "archived", status: restoreStatus },
        moderation: { action: "process_restored", restored_by: adminId },
      },
    }),
  });

  process.status = restoreStatus;
  process.state = nextState;
  process.updatedAt = restoredAt.updated_at;
  process.version = restoredAt.version;

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
 * Live processes on the hub in scope, counted per plugin (plugins with none
 * are absent). Switching a plugin off hides its live items from residents
 * and suspends their deadline-close: the close is lazy, run by the read
 * paths, which skip a disabled type before it runs, so a vote past its
 * closing time stays open until the plugin is back on and then closes on
 * the first read (tests/api/pluginToggles.test.ts). The Plugins page warns
 * with these numbers.
 */
export async function countLiveProcessesByPlugin(): Promise<Partial<Record<PluginId, number>>> {
  const rows = await readAll((from, to) =>
    db()
      .from("processes")
      .select<{ type: string }>("type")
      .in("status", [...LIVE_STATUSES])
      .order("id", { ascending: true })
      .range(from, to),
  );
  const counts: Partial<Record<PluginId, number>> = {};
  for (const { type } of rows) {
    const plugin = PROCESS_TYPE_PLUGINS[type];
    if (plugin) counts[plugin] = (counts[plugin] ?? 0) + 1;
  }
  return counts;
}

/**
 * The set of process ids that are NOT publicly visible (archived or still
 * pending review). Used by the events feed + digest to suppress cards for
 * content that has been archived/removed — otherwise an archived process's
 * historical `civic.process.created` / `.started` / proposal-submitted events
 * linger in `/events` forever and render ghost feed posts. Paged: archived
 * processes pile up over the years. The hub's own feed checks each page's
 * processes instead (services/feedPage.ts).
 */
export async function getNonPublicProcessIds(): Promise<Set<string>> {
  const data = await readAll((from, to) =>
    db()
      .from("processes")
      .select<{ id: string }>("id")
      .in("status", [...NON_PUBLIC_STATUSES])
      .order("id", { ascending: true })
      .range(from, to),
  );
  return new Set(data.map((r) => r.id));
}

/**
 * Whether a process's history may be served when it is asked for by id:
 * the rule the process pages apply (getProcessState). False for a process
 * that is archived or still pending review. An id with no process row (a
 * purged process, an id that never was one) is served as the feed serves
 * it: the rule withholds what is hidden, not what is gone. `hubSurface` adds
 * the hub UI's own rule, a switched-off plugin; the protocol surface
 * (GET /events) keeps a switched-off type's record.
 */
export async function isProcessHistoryServable(
  processId: string,
  opts: { hubSurface: boolean },
): Promise<boolean> {
  const rows = await db()
    .from("processes")
    .select<{ status: ProcessStatus; type: string }>("status, type")
    .eq("id", processId)
    .limit(1);
  const row = rows[0];
  if (!row) return true;
  if (!isPubliclyFetchable(row.status)) return false;
  return !opts.hubSurface || isProcessTypeEnabled(row.type);
}

/**
 * What the hub's own UI surfaces (the feed, the digest) leave out: every
 * non-public process, plus every process of a type whose plugin this hub has
 * switched off. The protocol surface (GET /events) reads
 * getNonPublicProcessIds() instead, so what a hub published stays in its
 * published record when a plugin is switched off.
 */
export async function getHiddenProcessIds(): Promise<Set<string>> {
  const ids = await getNonPublicProcessIds();
  for (const id of await getDisabledTypeProcessIds()) ids.add(id);
  return ids;
}

/**
 * Every process, in any status, whose type's plugin is switched off on the
 * hub in scope. Empty (and no query) while every plugin is on. For lists of
 * things that point at processes without carrying their type: reviews.
 */
export async function getDisabledTypeProcessIds(): Promise<Set<string>> {
  const disabled = disabledProcessTypes();
  if (disabled.length === 0) return new Set();
  const off = await readAll((from, to) =>
    db()
      .from("processes")
      .select<{ id: string }>("id")
      .in("type", disabled)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return new Set(off.map((r) => r.id));
}


/**
 * All archived processes, newest first — for the admin Archived view where an
 * admin can review and restore. Bypasses the public NON_PUBLIC_STATUSES filter
 * by design (admin-only surface). `types` narrows it in SQL: the
 * meeting-summary dedupe reads archived summaries so an admin's delete sticks
 * (review M5).
 */
export async function getArchivedProcesses(types?: string[]): Promise<Process[]> {
  const data = await readAll((from, to) => {
    let q = db()
      .from("processes")
      .select<ProcessRow>("*")
      .eq("status", "archived");
    if (types && types.length > 0) q = q.in("type", types);
    return q
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });
  return data.map((r) => rowToProcess(r));
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

export async function clearProcesses(): Promise<void> {
  await db().from("processes").delete().neq("id", "");
}
