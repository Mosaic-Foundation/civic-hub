// Process handler interface — the contract every process type must implement.
//
// Each handler encapsulates all logic for a single process type:
//   - initializing state on creation
//   - handling actions (mutations)
//   - producing a read model for UI consumption
//   - producing a summary for list views

import { Process, ProcessAction, CreateProcessInput } from "../models/process.js";
import type { BriefContent } from "../modules/civic.brief/index.js";
import type { SchemaRequirement } from "../db/schemaContract.js";

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
