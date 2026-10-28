// civic.vote module — service interface
//
// This module is self-contained and portable across hubs.
// It exposes pure service functions that operate on VoteProcessState.
// No route handlers, no UI logic, no direct hub imports.
//
// The host hub provides:
//   - a VoteConfig object
//   - an EmitEventFn callback for event emission
//
// Action functions are async because event emission is durable — the host
// hub awaits the DB write before the action completes.

import { CHECK_MODES, DEFAULT_CHECK_MODE, checkModeOf, isCheckMode } from "../../src/shared/checkMode.js";
import { filledOptions, overlongOption, VOTE_OPTION_MAX } from "../../src/shared/voteOptions.js";
import { ConflictError, ValidationError } from "@civic-social/plugin-sdk/first-party";
import type {
  VoteConfig,
  VoteProcessState,
  EmitEventFn,
  ActionOutcome,
} from "./models.js";
import { assertTransition, isVotingOpen, isAcceptingSupport, isTerminal } from "./lifecycle.js";
import { computeTally } from "./results.js";
import { getVotingMethod, DEFAULT_METHOD, type Ballot } from "./methods.js";
import {
  emitProposed,
  emitThresholdMet,
  emitStarted,
  emitVoteSubmitted,
  emitEnded,
  emitAggregationCompleted,
  emitResultPublished,
} from "./events.js";

export type { VoteConfig, VoteProcessState, VoteResult, EmitEventFn, ActionOutcome } from "./models.js";
export { canTransition, isVotingOpen, isAcceptingSupport, isTerminal } from "./lifecycle.js";
export { computeTally } from "./results.js";
export { getVotingMethod, getAvailableMethods, DEFAULT_METHOD } from "./methods.js";
export type { VotingMethod, Ballot } from "./methods.js";

// --- Process Descriptor ---
// Static metadata describing the civic.vote process type, its lifecycle,
// available actions, and configuration schema. Exposed for discovery endpoints.

// What this type is: its manifest, ./manifest.ts.

/**
 * Default voting window (30 days) when a caller doesn't specify one. Owned by
 * this portable module and re-used by every vote-creation path so the fallback
 * is consistent. Distinct from a proposal's support-collection duration.
 * Rarely fires — the creation UIs normally pass an explicit value.
 */
export const DEFAULT_VOTING_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SUPPORT_THRESHOLD = 5;

/**
 * State config for a resident-submitted vote, from the hub's endorsement
 * threshold (Admin Settings). Snapshotted onto the vote at submission, so a
 * later change to the setting applies only to votes submitted after it.
 *
 * 0 means "no support phase": the vote is configured for direct activation
 * and opens for ballots the moment an admin approves it — admin review is
 * the only gate (Adam, 2026-09-06). Any positive number is the count of
 * endorsements a proposed vote needs before it opens.
 */
export function supportPhaseConfig(
  threshold: number,
): Pick<VoteConfig, "support_threshold" | "activation_mode"> {
  const n = Math.max(0, Math.round(threshold));
  return {
    support_threshold: n,
    activation_mode: n === 0 ? "direct" : "proposal_required",
  };
}

// --- Helpers -----------------------------------------------------------------

/** Resolve the method for a state, defaulting for backward compat */
function resolveMethod(state: VoteProcessState): string {
  return state.method ?? DEFAULT_METHOD;
}

// --- Factory ---

export function createVoteState(
  input: Record<string, unknown>,
  config?: Partial<VoteConfig>
): VoteProcessState {
  const methodKey = (input.method as string | undefined) ?? DEFAULT_METHOD;
  const method = getVotingMethod(methodKey);

  // Blank options are dropped, not refused: an empty field is an accident.
  if (input.options !== undefined && !Array.isArray(input.options)) {
    throw new ValidationError("options must be a list of option texts");
  }
  const inputOptions = Array.isArray(input.options) ? filledOptions(input.options) : undefined;
  const options = inputOptions ?? method.defaultOptions ?? [];

  // Options made now are at most VOTE_OPTION_MAX characters (votes made
  // before the limit keep theirs; this runs only when one is made).
  const long = overlongOption(inputOptions ?? []);
  if (long) throw new ValidationError(`Each option can be at most ${VOTE_OPTION_MAX} characters. Shorten "${long.slice(0, 40)}…".`, "option_too_long");

  if (options.length < method.minOptions) {
    throw new ValidationError(
      `Voting method "${methodKey}" requires at least ${method.minOptions} options, got ${options.length}`,
    );
  }

  if (input.check_mode !== undefined && !isCheckMode(input.check_mode)) {
    throw new ValidationError(`check_mode must be one of: ${CHECK_MODES.join(", ")}`, "invalid_check_mode");
  }

  return {
    type: "civic.vote",
    check_mode: isCheckMode(input.check_mode) ? input.check_mode : DEFAULT_CHECK_MODE,
    method: methodKey,
    status: "draft",
    options,
    total_votes: 0,
    supporters: {},
    support_count: 0,
    config: {
      support_threshold: config?.support_threshold
        ?? (input.support_threshold as number | undefined)
        ?? DEFAULT_SUPPORT_THRESHOLD,
      voting_duration_ms: config?.voting_duration_ms
        ?? (input.voting_duration_ms as number | undefined)
        ?? DEFAULT_VOTING_DURATION_MS,
      activation_mode: config?.activation_mode
        ?? (input.activation_mode as "direct" | "proposal_required" | undefined)
        ?? "direct",
    },
    voting_opens_at: null,
    voting_closes_at: null,
    result: null,
  };
}

// --- Event context helper ---

interface ProcessContext {
  process_id: string;
  jurisdiction: string;
  emit: EmitEventFn;
}

// --- Actions ---

/**
 * Propose a vote for community support.
 * Transition: draft → proposed
 */
export async function propose(
  state: VoteProcessState,
  actor: string,
  ctx: ProcessContext
): Promise<ActionOutcome> {
  assertTransition(state.status, "proposed", state.config.activation_mode);
  state.status = "proposed";

  await emitProposed(ctx, actor, state);

  return { state, result: { status: "proposed" } };
}

/**
 * Add support/endorsement to a proposed vote.
 * May trigger proposed → threshold_met (and auto-activation if configured).
 */
export async function addSupport(
  state: VoteProcessState,
  actor: string,
  ctx: ProcessContext
): Promise<ActionOutcome> {
  if (!isAcceptingSupport(state.status)) {
    throw new ConflictError(`Cannot support: process is in "${state.status}" state, not "proposed"`);
  }

  if (state.supporters[actor]) {
    throw new ConflictError("You have already supported this proposal", "already_supported");
  }

  state.supporters[actor] = true;
  state.support_count += 1;

  // Check threshold
  if (state.support_count >= state.config.support_threshold) {
    assertTransition(state.status, "threshold_met", state.config.activation_mode);
    state.status = "threshold_met";

    await emitThresholdMet(ctx, actor, state);

    // In proposal_required mode, auto-activate once threshold is met.
    // In direct mode, this path is unreachable (draft → active skips proposal).
    if (state.config.activation_mode === "proposal_required") {
      return activate(state, actor, ctx);
    }

    return {
      state,
      result: {
        support_count: state.support_count,
        threshold_met: true,
      },
    };
  }

  return {
    state,
    result: { support_count: state.support_count },
  };
}

/**
 * Remove support/endorsement from a proposed vote.
 * Only allowed while the process is in "proposed" state (before threshold is met).
 * Once threshold_met or active, endorsements are locked.
 */
export async function removeSupport(
  state: VoteProcessState,
  actor: string,
  _ctx: ProcessContext
): Promise<ActionOutcome> {
  if (!isAcceptingSupport(state.status)) {
    throw new ConflictError(
      `Cannot remove endorsement: process is in "${state.status}" state. ` +
      `Endorsements can only be removed while the proposal is gathering support.`
    );
  }

  if (!state.supporters[actor]) {
    throw new ConflictError("You have not endorsed this proposal", "not_supported");
  }

  delete state.supporters[actor];
  state.support_count -= 1;

  return {
    state,
    result: { support_count: state.support_count, removed: true },
  };
}

/**
 * Activate the vote — opens the voting window.
 * Transition: draft → active (direct) or threshold_met → active
 */
export async function activate(
  state: VoteProcessState,
  actor: string,
  ctx: ProcessContext
): Promise<ActionOutcome> {
  assertTransition(state.status, "active", state.config.activation_mode);

  const now = new Date();
  state.status = "active";
  state.voting_opens_at = now.toISOString();
  state.voting_closes_at = new Date(
    now.getTime() + state.config.voting_duration_ms
  ).toISOString();

  await emitStarted(ctx, actor, state);

  return {
    state,
    result: {
      status: "active",
      voting_opens_at: state.voting_opens_at,
      voting_closes_at: state.voting_closes_at,
    },
  };
}

/**
 * Submit a vote during the active period.
 * Delegates ballot validation to the voting method.
 *
 * Ballot secrecy: this function never stores the ballot in state — the
 * host hub persists it via civic.receipts. `changing` is true when the voter
 * presented the receipt and change key they hold (a change of their vote),
 * false for a first vote.
 */
export async function submitVote(
  state: VoteProcessState,
  actor: string,
  ballotInput: unknown,
  changing: boolean,
  ctx: ProcessContext
): Promise<ActionOutcome> {
  if (!isVotingOpen(state.status)) {
    throw new ConflictError(`Cannot submit vote: process is in "${state.status}" state, not "active"`);
  }

  // Auto-close if voting window has expired. Guard against a malformed
  // voting_closes_at: an Invalid Date makes the comparison silently false,
  // which would let votes through forever after the close time.
  if (state.voting_closes_at) {
    const closesAt = new Date(state.voting_closes_at).getTime();
    if (Number.isFinite(closesAt) && Date.now() > closesAt) {
      state.status = "closed";
      throw new ConflictError("Cannot submit vote: voting window has expired", "vote_closed");
    }
  }

  const methodKey = resolveMethod(state);
  const method = getVotingMethod(methodKey);

  const ballot = method.validateBallot(ballotInput, state.options);

  // `total_votes` is not touched here: the host adds one for a first vote in
  // the same transaction as the ballot (civic-hub: cast_ballot), so two
  // voters at once cannot both read N and write N+1. A change is the voter
  // presenting their own receipt and is not counted again; a change to the
  // same choice is recognised by the database, which then writes nothing.

  await emitVoteSubmitted(ctx, actor, changing);

  return { state, result: { ballot, changed: changing } };
}

/**
 * Close the vote — ends the voting window and runs aggregation.
 * Transition: active → closed
 *
 * Emits Phase 3→4 boundary events: `ended` (participation closed) and
 * `aggregation_completed` (tally produced). Does NOT emit
 * `result_published` — that only fires once an accompanying
 * civic.vote_results record has been approved by an admin, via finalizeVote().
 */
export async function closeVote(
  state: VoteProcessState,
  actor: string,
  ballots: Ballot[],
  ctx: ProcessContext
): Promise<ActionOutcome> {
  assertTransition(state.status, "closed", state.config.activation_mode);

  state.status = "closed";
  const methodKey = resolveMethod(state);
  const result = computeTally(ballots, state.options, methodKey);
  const participantCount = ballots.length;

  await emitEnded(ctx, actor, result);
  await emitAggregationCompleted(ctx, actor, result, participantCount, methodKey);

  return {
    state,
    result: { tally: result.tally, total_votes: result.total_votes },
  };
}

/**
 * Finalize the vote — publish the result.
 * Transition: closed → finalized
 *
 * Library-only entry point: there is no HTTP action wired to this. Since
 * 2026-10-07 the vote's own close calls it (`atClose`: the vote announces its
 * results itself, independent of any brief). The older approval paths
 * (civic.vote_results, and a brief approved for a vote closed before then)
 * call it without the mark.
 */
export async function finalizeVote(
  state: VoteProcessState,
  actor: string,
  ballots: Ballot[],
  ctx: ProcessContext,
  opts: { atClose?: boolean } = {},
): Promise<ActionOutcome> {
  assertTransition(state.status, "finalized", state.config.activation_mode);

  const methodKey = resolveMethod(state);
  const result = computeTally(ballots, state.options, methodKey);
  state.status = "finalized";
  state.result = result;

  await emitResultPublished(ctx, actor, result, opts.atClose === true);

  return {
    state,
    result: {
      tally: result.tally,
      total_votes: result.total_votes,
      computed_at: result.computed_at,
    },
  };
}

// --- Read models ---

/**
 * Actor-specific vote info, resolved by the host hub from the
 * civic.receipts tables (this module never touches storage):
 *   has_voted          — vote_participation lookup (null when no actor)
 *   (no "your current vote": the hub keeps no link from a voter to a
 *   ballot; the voter's browser knows its own choice from the receipt it
 *   holds — 2026-10-10)
 *   ballots            — all anonymized ballots, needed only when results
 *                        are visible and no finalized result snapshot exists
 */
export interface VoteReadContext {
  has_voted: boolean | null;
  ballots: Ballot[] | null;
}

export function getReadModel(
  state: VoteProcessState,
  processMeta: { id: string; title: string; description: string; createdAt: string; createdBy: string },
  actor: string | undefined,
  view: VoteReadContext
): Record<string, unknown> {
  const methodKey = resolveMethod(state);
  const tally =
    state.result ??
    (view.ballots ? computeTally(view.ballots, state.options, methodKey) : null);
  const hasVoted = view.has_voted;
  const hasSupported = actor ? actor in state.supporters : null;

  // Results visible after voting, when closed, or when finalized
  const showResults =
    state.status === "closed" ||
    state.status === "finalized" ||
    hasVoted === true;

  return {
    id: processMeta.id,
    type: "civic.vote",
    method: methodKey,
    title: processMeta.title,
    description: processMeta.description,
    status: state.status,
    options: state.options,
    tally: showResults && tally ? tally.tally : null,
    total_votes: showResults ? tally?.total_votes ?? state.total_votes : null,
    has_voted: hasVoted,
    has_supported: hasSupported,
    support_count: state.support_count,
    support_threshold: state.config.support_threshold,
    activation_mode: state.config.activation_mode,
    voting_opens_at: state.voting_opens_at,
    voting_closes_at: state.voting_closes_at,
    closes_at: state.voting_closes_at, // backward compat alias
    result: state.status === "finalized" ? state.result : null,
    // How a receipt check answers once it closes.
    check_mode: checkModeOf(state),
    created_at: processMeta.createdAt,
    created_by: processMeta.createdBy,
  };
}

export function getSummary(
  state: VoteProcessState,
  processMeta: { id: string; title: string; createdAt: string; createdBy: string; status: string }
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.vote",
    method: resolveMethod(state),
    title: processMeta.title,
    status: processMeta.status,
    total_votes: state.total_votes ?? 0,
    support_count: state.support_count,
    support_threshold: state.config.support_threshold,
    closes_at: state.voting_closes_at,
    created_at: processMeta.createdAt,
    created_by: processMeta.createdBy,
  };
}
