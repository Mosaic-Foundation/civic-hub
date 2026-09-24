// civic.vote_results module — event emission helpers
//
// Maps lifecycle transitions and admin actions to canonical event types
// per Civic Event Spec v0.1 §7. All events emitted through the host hub's
// emit callback, which handles ID, timestamp, source, and URL construction.

import type { VoteResultsProcessContext, VoteResultsProcessState } from "./models.js";

function voteResultsPath(process_id: string): string {
  return `/vote-results/${process_id}`;
}

export async function emitVoteResultsCreated(
  ctx: VoteResultsProcessContext,
  actor: string,
  state: VoteResultsProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.created",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.vote_results",
    action_url_path: voteResultsPath(ctx.process_id),
    data: {
      process: {
        type: "civic.vote_results",
        title: state.content.title,
        source_process_id: state.source_process_id,
      },
    },
  });
}

/**
 * Emitted immediately after vote-results creation. The aggregation step
 * is the generation of structured content from the underlying vote; it
 * completes synchronously at creation time, so this event fires together
 * with `created`.
 */
export async function emitVoteResultsAggregationCompleted(
  ctx: VoteResultsProcessContext,
  actor: string,
  state: VoteResultsProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.aggregation_completed",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.vote_results",
    action_url_path: voteResultsPath(ctx.process_id),
    data: {
      aggregation_method: "summarization",
      participant_count: state.content.participation_count,
      result_type: "summary",
      result_summary: summarizePositions(state),
    },
  });
}

export async function emitVoteResultsUpdated(
  ctx: VoteResultsProcessContext,
  actor: string,
  state: VoteResultsProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.updated",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.vote_results",
    action_url_path: voteResultsPath(ctx.process_id),
    data: {
      vote_results: {
        publication_status: state.publication_status,
        comments_count: state.content.comments.length,
        has_admin_notes: state.content.admin_notes.trim().length > 0,
      },
    },
  });
}

/**
 * Phase 5 (Outcome / Decision) event per Civic Process Spec §10. Records
 * the advisory outcome of the linked vote.
 */
export async function emitVoteResultsOutcomeRecorded(
  ctx: VoteResultsProcessContext,
  actor: string,
  state: VoteResultsProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.outcome_recorded",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.vote_results",
    action_url_path: voteResultsPath(ctx.process_id),
    data: {
      outcome_type: "advisory",
      outcome_description: summarizePositions(state),
      linked_process_id: state.source_process_id,
    },
  });
}

/**
 * Phase 6 (Publication) event per Civic Process Spec §6. Makes the
 * vote-results record visible to the public feed. The feed renders this
 * as a "Vote results: <title>" post with the "Vote results" pill.
 *
 * Discriminator field: `data.results_id` (new in Slice 8.5). Older
 * events emitted before the rename carry `data.brief_id` instead — both
 * Feed and digest filters accept either field for backwards compat. The
 * legacy alias can be removed after a sufficient grace period.
 */
export async function emitVoteResultsResultPublished(
  ctx: VoteResultsProcessContext,
  actor: string,
  state: VoteResultsProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.vote_results",
    action_url_path: voteResultsPath(ctx.process_id),
    data: {
      results_id: ctx.process_id,
      source_process_id: state.source_process_id,
      participation_count: state.content.participation_count,
      headline_result: summarizePositions(state),
    },
  });
}

function summarizePositions(state: VoteResultsProcessState): string {
  const positions = state.content.position_breakdown;
  if (positions.length === 0 || state.content.participation_count === 0) {
    return "No participation recorded.";
  }
  const top = positions[0];
  return `${top.option_label}: ${top.count} of ${state.content.participation_count} (${top.percentage}%)`;
}
