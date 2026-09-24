// civic.meeting_summary module — event emission helpers
//
// Meeting summaries emit the canonical lifecycle phase events per Civic
// Process Spec §7.4 and §7.6, skipping Phases 1–3 (Framing, Activation,
// Participation) for the same reason civic.announcement does: meetings
// aren't participation processes. The civic work of the summary begins
// at aggregation (the AI summarization of the source materials).
//
// Lifecycle phase → event mapping for this module:
//   Phase 0 Initiation      → civic.process.created (emitted by processService)
//   Phase 4 Aggregation     → civic.process.aggregation_completed (here)
//   (edits during review)   → civic.process.updated (here)
//   Phase 5 Outcome/Decision → civic.process.outcome_recorded (here, on approval)
//   Phase 6 Publication     → civic.process.result_published (here, on approval)

import type {
  MeetingSummaryProcessContext,
  MeetingSummaryProcessState,
} from "./models.js";

function summaryPath(process_id: string): string {
  return `/meeting-summary/${process_id}`;
}

/**
 * Phase 4 (Aggregation) event per Civic Process Spec §9. Fires
 * immediately after creation because aggregation is synchronous with
 * creation for meeting summaries — the Claude-produced blocks are the
 * aggregated output, and they're already populated by the pipeline.
 */
export async function emitMeetingSummaryAggregationCompleted(
  ctx: MeetingSummaryProcessContext,
  actor: string,
  state: MeetingSummaryProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.aggregation_completed",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.meeting_summary",
    action_url_path: summaryPath(ctx.process_id),
    data: {
      aggregation_method: "summarization",
      // Meeting summaries have no participants — the meeting is a source,
      // not a participation process. Spec §9.3 requires the field; value
      // can be 0.
      participant_count: 0,
      result_type: "summary",
      result_summary: `${state.blocks.length} topic block${
        state.blocks.length === 1 ? "" : "s"
      } covering ${state.meeting_title}`,
      block_count: state.blocks.length,
      meeting_date: state.meeting_date,
    },
  });
}

/**
 * Fires on admin edits during review. `editedFields` indicates what
 * changed so downstream consumers (audit logs, admin history) can
 * understand the mutation without diffing the full state.
 */
export async function emitMeetingSummaryUpdated(
  ctx: MeetingSummaryProcessContext,
  actor: string,
  state: MeetingSummaryProcessState,
  editedFields: string[],
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.updated",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.meeting_summary",
    action_url_path: summaryPath(ctx.process_id),
    data: {
      meeting_summary: {
        approval_status: state.approval_status,
        block_count: state.blocks.length,
        edit_count: state.edit_count,
        edited_fields: editedFields,
        has_admin_notes: state.admin_notes.trim().length > 0,
        ai_instructions_used_hash_len: state.ai_instructions_used.length,
      },
    },
  });
}

/**
 * Phase 5 (Outcome / Decision) event per Civic Process Spec §10.
 * Meeting summaries carry `outcome_type: "informational"` — the summary
 * itself is the outcome; there is no downstream decision-maker acting on
 * it and no linked process (the source is an external meeting, not
 * another Civic Process, so no `linked_process_id`).
 */
export async function emitMeetingSummaryOutcomeRecorded(
  ctx: MeetingSummaryProcessContext,
  actor: string,
  state: MeetingSummaryProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.outcome_recorded",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.meeting_summary",
    action_url_path: summaryPath(ctx.process_id),
    data: {
      outcome_type: "informational",
      outcome_description: `Meeting summary for ${state.meeting_title} on ${state.meeting_date}`,
    },
  });
}

/**
 * Phase 6 (Publication) event per Civic Process Spec §6. Makes the
 * summary publicly visible. The Feed renders this as a "Meeting summary:
 * <date>" post. Provenance links travel on the event so digest/feed can
 * display them without a second fetch.
 */
export async function emitMeetingSummaryResultPublished(
  ctx: MeetingSummaryProcessContext,
  actor: string,
  state: MeetingSummaryProcessState,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.meeting_summary",
    action_url_path: summaryPath(ctx.process_id),
    data: {
      // `meeting_summary` is the primary discriminator used by Feed +
      // digest filter to route this event (brief_id / announcement are
      // the existing ones for civic.brief / civic.announcement).
      meeting_summary: {
        id: ctx.process_id,
        meeting_title: state.meeting_title,
        meeting_date: state.meeting_date,
        block_count: state.blocks.length,
      },
      summary_id: ctx.process_id,
      meeting_date: state.meeting_date,
      meeting_title: state.meeting_title,
      block_count: state.blocks.length,
      source_video_url: state.source_video_url,
      source_minutes_url: state.source_minutes_url,
    },
  });
}
