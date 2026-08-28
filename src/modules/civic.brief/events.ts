// civic.brief module — event emission helpers
//
// Every brief lifecycle transition emits a spec-compliant Civic Event via
// the injected ctx.emit. Event types mirror civic.vote_results so the feed
// classifier and digest treat briefs consistently. The public brief page
// lives at /brief/:id, stamped into action_url_path.

import type { BriefProcessContext, BriefProcessState } from "./models.js";

const PROCESS_TYPE = "civic.brief";

function publicPath(processId: string): string {
  return `/brief/${processId}`;
}

/** Phase 0 — the brief record was created (pending review). This never
 *  reaches the public feed: the feed classifier is default-closed and only
 *  handles civic.brief's result_published, so a pending brief's created
 *  event is inert until publication. */
export async function emitBriefCreated(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.created",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: PROCESS_TYPE,
    action_url_path: publicPath(ctx.process_id),
    data: {
      process: { type: PROCESS_TYPE, title: state.content.title },
      source_process_id: state.source_process_id,
      source_process_type: state.source_process_type,
    },
  });
}

/** Phase 4 — aggregation/generation completed. */
export async function emitBriefAggregationCompleted(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.aggregation_completed",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: PROCESS_TYPE,
    data: {
      source_process_id: state.source_process_id,
      participation_count: state.content.participation_count,
    },
  });
}

/** Admin edit during review — restricted (not a public feed event). */
export async function emitBriefUpdated(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.updated",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: PROCESS_TYPE,
    data: {
      publication_status: state.publication_status,
    },
  });
}

/** Phase 5 — outcome recorded (delivered to officials). */
export async function emitBriefOutcomeRecorded(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.outcome_recorded",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: PROCESS_TYPE,
    data: {
      source_process_id: state.source_process_id,
      delivered_to_count: state.delivered_to.length,
    },
  });
}

/**
 * An official responded to a published brief. Always emitted — the event
 * log records every response (design constraint #2). Whether the FEED
 * shows a card is decided by `feed_anchor`, stamped here from the pure
 * isFeedAnchor decision: at most one anchored response per brief per
 * 24h, so a burst of responses is one card. The shared classifier
 * (feedActivity.ts) renders only anchored responses.
 */
export async function emitBriefResponseAdded(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
  response: {
    excerpt: string;
    official_type: string;
    official_title: string;
    responder_name: string;
    feed_anchor: boolean;
  },
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.action_taken",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: PROCESS_TYPE,
    action_url_path: publicPath(ctx.process_id),
    data: {
      action: "official_response",
      feed_anchor: response.feed_anchor,
      brief: {
        title: state.content.title,
        source_process_id: state.source_process_id,
        source_process_type: state.source_process_type,
      },
      response: {
        excerpt: response.excerpt,
        official_type: response.official_type,
        official_title: response.official_title,
        responder_name: response.responder_name,
      },
    },
  });
}

/** Phase 6 — the brief is published (public). This is the feed-worthy one. */
export async function emitBriefResultPublished(
  ctx: BriefProcessContext,
  actor: string,
  state: BriefProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: PROCESS_TYPE,
    action_url_path: publicPath(ctx.process_id),
    // NOTE: intentionally NOT `brief_id` — that key is a legacy alias the
    // feed classifier maps to civic.vote_results. A civic.brief is
    // classified by processType instead (added in the feed stage).
    data: {
      brief: {
        source_process_id: state.source_process_id,
        source_process_type: state.source_process_type,
        headline: state.content.headline,
        title: state.content.title,
      },
    },
  });
}
