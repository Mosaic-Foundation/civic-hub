// Process handler interface — the contract every process type must implement.
//
// Each handler encapsulates all logic for a single process type:
//   - initializing state on creation
//   - handling actions (mutations)
//   - producing a read model for UI consumption
//   - producing a summary for list views

import { Process, ProcessAction, CreateProcessInput } from "../models/process.js";
import type { SubmissionField, SubmissionSource } from "../shared/submissionPreview.js";
import type { BriefContent } from "../modules/civic.brief/index.js";
import type { SchemaRequirement } from "../db/schemaContract.js";
import type { AssistantTypeConfig } from "../modules/civic.assistant/index.js";

/**
 * Whether — and which parts of — a live process its creator may edit.
 * Declared per type; a type without `editPolicy` is not editable at all.
 * `locked_fields` names submitted fields that must not change (a project's
 * title once anyone supports it). `reason` is shown when not editable.
 */
export interface EditPolicy {
  editable: boolean;
  locked_fields: string[];
  reason?: string;
}

/** One applied edit — what changed, before and after, per field. */
export interface EditChangeSet {
  changed_fields: string[];
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
}

/**
 * What happens to a process of this type the moment an admin approves it.
 *
 * Before this seam the review service branched on `proc.type` three separate
 * times — for the status to write, for the lifecycle action to dispatch, and
 * for what to do when that action failed — with votes and conversations
 * carrying two *different* failure policies hardcoded in a shared service. A
 * type registered tomorrow silently got neither, and the only signal when a
 * best-effort activation failed was a console.error nobody reads. (That is
 * how a conversation approved on 2026-09-01 sat at "waiting to start" for
 * three days: Polis rejected a duplicate seed statement, the catch swallowed
 * it, and no one was told.)
 *
 * A handler now declares its own answer, and the shared service enforces it
 * uniformly. A type that declares nothing gets the default — go straight to
 * "active", dispatch nothing — which is what every other type already did.
 */
export interface ApprovalActivation {
  /**
   * The `processes.status` to write when the review is approved.
   * Default "active". Votes use "proposed" (gather support to threshold);
   * conversations use "draft" until the live Polis conversation exists.
   */
  status: string;

  /** A lifecycle action to dispatch once the approval has committed. */
  action?: {
    /** Action type, e.g. "process.propose" or "start". */
    type: string;
    /**
     * What a failure means:
     *  - "required"    — roll the approval back to pending_review so the admin
     *                    can retry cleanly. Nothing is left half-published.
     *  - "best_effort" — the approval stands and the process rests at
     *                    `status`; an admin is emailed so the stall is never
     *                    silent, and it can be driven manually.
     */
    onFailure: "required" | "best_effort";
  };
}

/** Open Graph-style preview of one process page. */
export interface ShareMeta {
  title: string;
  description: string;
  /** Absolute or site-relative; null = the hub's default banner. */
  image: string | null;
  /** Canonical UI path for this process (its handler's detailPath). */
  path: string;
}

export interface ProcessHandler {
  /** The process type this handler manages (e.g., "civic.vote") */
  type: string;

  /**
   * Optional: the tables and columns this handler needs to function.
   * Declared here rather than in a central list so that enabling or omitting
   * a process type carries its storage expectations with it. Checked at
   * startup and by GET /health — see src/db/schemaContract.ts.
   */
  requiredSchema?: SchemaRequirement[];

  /**
   * Optional: the canonical public UI path for one process of this type,
   * e.g. `/project/proj_abc`. Omit and the generic `/process/:id` is used.
   *
   * Declared here rather than in a switch statement so that link cards and
   * search hits route correctly for a process type the moment it is
   * registered. Adding a type with its own detail page means setting this one
   * field — nothing downstream enumerates process types.
   */
  detailPath?(id: string): string;

  /**
   * Optional: what approval does to a process of this type — the status it
   * lands on, and any lifecycle action that has to run for it to be real.
   *
   * Same seam as detailPath / editPolicy / generateBrief: the handler owns
   * the policy, the shared review service enforces it. Omit it and approval
   * publishes the process as "active" with no action to fail — the right
   * default for a type that is live the moment it is approved.
   */
  activationOnApproval?(process: Process): ApprovalActivation;

  /**
   * Optional: the fields a creator submitted, for the "Your submission" /
   * admin review previews. The default (registry.describeSubmission) walks
   * the process `content` block generically, so a type whose submission
   * lives in `content` needs nothing here. Declare this only when part of
   * the submission lives on `state` (votes: options + method + window;
   * conversations: seed statements + sources + window) — and prefer
   * extending the default (`describeSubmissionFields(source, stateKeys)`)
   * over hand-building a list, so unknown keys still surface.
   *
   * Same seam as detailPath / requiredSchema / generateBrief: the handler
   * declares what it owns; no page enumerates process types.
   */
  describeSubmission?(source: SubmissionSource): SubmissionField[];

  /**
   * Optional: opt this type into creator edits of a LIVE process (see
   * services/processEdits.ts). Only projects declare it today — every other
   * type is uneditable once submitted, by decision (Adam, 2026-09-03).
   * The handler owns the facts (its child table's status, support count),
   * so it decides; the shared service enforces, diffs, records, notifies.
   */
  editPolicy?(process: Process): Promise<EditPolicy> | EditPolicy;

  /**
   * Optional: user ids to notify when the substance of this process is
   * edited (a project's supporters). Progress updates never trigger this —
   * only edits to what people signed on to.
   */
  listSupporters?(processId: string): Promise<string[]>;

  /**
   * Optional: make a fresh draft, owned by `editorId`, prefilled from a LIVE
   * process — for editing a process that has no draft on record (reviewed
   * before drafts were recorded, 2026-09-02) or when the editor is not the
   * creator (an admin editing someone's project must not write into the
   * creator's draft). Returns the new draft id.
   */
  draftFromProcess?(
    process: Process,
    editorId: string,
    links: Array<{ to_id: string; relation: string }>,
  ): Promise<string>;

  /**
   * Optional: overwrite an existing draft's submitted fields from the LIVE
   * process and clear its Code of Conduct result — so every edit starts
   * from what is actually published, never from an abandoned edit's text
   * or a stale suggestion card (Adam: "stuck in edit mode").
   */
  syncDraftFromProcess?(
    draftId: string,
    process: Process,
    links: Array<{ to_id: string; relation: string }>,
  ): Promise<void>;

  /**
   * Optional: the inverse of listSupporters — every process of this type
   * the given user supports. Drives the account-menu badge for supporters
   * of an edited process (services/editNotifications.ts).
   */
  listSupportedBy?(userId: string): Promise<string[]>;

  /**
   * Optional: mirror an applied edit into the type's own table (projects
   * keep title/description/sources/banner on `projects`). The shared service
   * has already updated the `processes` row and the creator's links.
   */
  onEdited?(process: Process, changes: EditChangeSet): Promise<void>;

  /**
   * Optional: what a social-media preview of one of this type's pages should
   * say. The default (services/shareMeta.ts) is the process title, its
   * description, and any `*image_url` on its state/content — which is right
   * for most types, so declare this only when the words live somewhere else
   * (a brief's headline). Return `null` to say "not shareable right now";
   * return partial fields to override just those.
   */
  describeShare?(process: Process): Partial<ShareMeta> | null | undefined;

  /**
   * Optional: the drafting page for one of this type's drafts, e.g.
   * `/projects/new?draft=pdraft_abc`. Used by "Edit & resubmit" to send the
   * creator back into their real form. Omit for a type without drafts.
   */
  draftPath?(draftId: string): string;

  /**
   * Optional: put a submitted draft back into "drafting" so the creator can
   * revise it after an admin requested changes. The submit path then calls
   * reviseAndResubmit (with `review_id`) instead of creating a new process.
   * Declared by the handler because each type owns its drafts table.
   */
  reopenDraft?(draftId: string): Promise<void>;

  /**
   * Optional: drafting-assistant config for this process type. Declaring it
   * is what opts a type into AI drafting help — the shared /assistant routes
   * dispatch on it, and the UI's creation shell shows the (collapsed)
   * assistant affordance only for types that declare it. A handler without
   * this simply gets a plain form: no assistant affordance, no assistant
   * routes. This is the single seam — no per-type assistant logic may live
   * outside the handler and the generic civic.assistant module.
   */
  getAssistantConfig?(): AssistantTypeConfig;

  /** Initialize process-specific state from creation input */
  initializeState(input: Record<string, unknown>): Record<string, unknown>;

  /**
   * Handle an action — returns result data. May mutate process/state and emit events.
   * Async because event emission is durable (persisted before the promise resolves).
   */
  handleAction(
    process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>>;

  /**
   * Produce a UI-friendly read model. Actor is optional (for visibility
   * rules). May be async — handlers that resolve per-actor data from
   * storage (e.g. civic.vote reading the receipts tables) return a
   * Promise; the service layer awaits either form.
   */
  getReadModel(
    process: Process,
    actor?: string,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;

  /** Produce a summary for list views */
  getSummary(process: Process): Record<string, unknown>;

  /**
   * Optional lazy deadline-close. Called on the read paths
   * (listProcessSummaries / getProcessState) for every process. If this
   * process has an elapsed deadline and is still open, perform the terminal
   * transition — persist the new status AND emit the lifecycle event — then
   * return the updated process. Otherwise return it unchanged.
   *
   * This is the single, type-agnostic close mechanism: each handler owns its
   * own deadline source (voting_closes_at / deliberation deadline /
   * proposals.closes_at), open-check, and close action, so process-specific
   * logic stays in the registry rather than leaking into the service layer.
   * Handlers for types without a deadline (e.g. projects) simply omit this.
   *
   * Implementations MUST guard date parsing (see utils/deadline.isPastDeadline)
   * so a malformed deadline can't make the close silently never fire. They MUST
   * be idempotent: re-reading an already-closed process is a no-op.
   */
  closeIfExpired?(process: Process): Promise<Process>;

  /**
   * Archive / restore hooks — sync storage this handler owns.
   *
   * `archiveProcess` flips `processes.status` and stores the archive metadata,
   * which is all a process type needs when its state lives entirely in that
   * row. It is NOT enough for a type that owns a child table or keeps its own
   * status inside `state`: civic.proposal and civic.project each have a
   * `status` column on their own table, and civic.wordcloud keeps `status` in
   * `state`, and every one of those read models reads its OWN copy. Archiving
   * without syncing them leaves a process hidden from the public list while
   * its detail page still renders it as live.
   *
   * This is the same seam as requiredSchema and generateBrief: the handler
   * declares what it owns, rather than the service growing a switch over
   * process types. A type whose state lives only in `processes` omits both.
   *
   * Called AFTER the processes row is updated, and best-effort: a failure is
   * logged and does not roll back the archive, because a process hidden from
   * the public with a stale child row is recoverable, while an admin unable to
   * take down bad content is not.
   */
  onArchive?(process: Process): Promise<void>;

  /**
   * Inverse of onArchive.
   *
   * `previousStatus` is the PROCESS status being restored. `archiveMeta` is
   * the `state.archive` block as it stood before restore removed it —
   * including anything onArchive stashed there. Both are passed explicitly
   * because restoreProcess deletes `state.archive` and overwrites the
   * in-memory copy before this runs, so a handler cannot read its own stash
   * off `process`.
   *
   * Handlers whose child vocabulary differs from ProcessStatus should stash
   * their own previous value in onArchive and read it back here. Deriving it
   * from `previousStatus` does not work: a process may be `finalized` while
   * its proposal row is `closed`, and nothing maps one to the other.
   */
  onRestore?(
    process: Process,
    previousStatus: string,
    archiveMeta: Record<string, unknown> | null,
  ): Promise<void>;

  /**
   * Universal brief hook. When a process closes, the service calls this to
   * produce the type-specific content for its Civic Brief — a short,
   * readable summary of the outcome that the admin reviews (in the Briefs
   * admin tab) and publishes. Returning content means "this process type
   * produces a brief on close"; returning null (or omitting the method)
   * means it does not.
   *
   * This is the single seam that makes briefs universal: adding a brief to
   * a new (or existing) process type is implementing this one method — the
   * generic civic.brief module handles review, delivery, publication, and
   * archival identically for every type.
   *
   * May be async — handlers that read aggregated results (e.g. a Polis
   * conversation summary, a proposal's endorsement tally) resolve them
   * here. Must be a pure snapshot: the returned content is frozen onto the
   * brief record; it must not mutate the source process.
   *
   * HISTORICAL NOTE, CORRECTED 2026-08-25: this used to say civic.vote kept
   * the civic.vote_results pipeline and did not implement this hook. No longer
   * true — civic.vote implements generateBrief (voteProcess.ts), and per that
   * file "no civic.vote_results is created anymore; briefs are the single
   * unified results artifact for every process type". civic.vote_results
   * survives only so already-published records keep their URLs. Corrected
   * rather than deleted because the stale note misled a reader during the
   * 2026-08-25 linking slice.
   */
  generateBrief?(process: Process): BriefContent | null | Promise<BriefContent | null>;
}

/**
 * Factory function type for creating processes from within handlers.
 * Injected by the service layer to avoid circular dependencies.
 * Used by handlers that need to spawn new processes (e.g., proposal → vote).
 *
 * Async because creation emits `civic.process.created` via the durable
 * event store.
 */
export type ProcessFactory = (input: CreateProcessInput) => Promise<Process>;

/**
 * Action-dispatcher type for executing a persisted action from within a handler.
 * Injected by the service layer (mirrors ProcessFactory) so handlers can
 * dispatch their own close action through the normal executeAction path —
 * which mutates state, persists it, and emits lifecycle events — without
 * importing processService directly (circular dependency).
 *
 * Used by lazy deadline-close (ProcessHandler.closeIfExpired) for types whose
 * close runs through the generic action dispatcher (vote, deliberation).
 */
export type ActionDispatcher = (
  processId: string,
  action: ProcessAction,
) => Promise<{ process: Process; result: Record<string, unknown> }>;
