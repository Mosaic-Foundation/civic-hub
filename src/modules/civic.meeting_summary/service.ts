// civic.meeting_summary module — service functions (pure state transitions)
//
// Pure state mutations + read models + the approval orchestration. No I/O
// lives here beyond what the injected callbacks perform. The host hub is
// responsible for persisting state changes after these functions return.

import type {
  CreateMeetingSummaryInput,
  MeetingSummaryPatch,
  MeetingSummaryProcessContext,
  MeetingSummaryProcessState,
  MeetingSummaryRevision,
  SummaryBlock,
} from "./models.js";
import { assertApprovalTransition, canApprove, canEdit } from "./lifecycle.js";
import {
  emitMeetingSummaryAggregationCompleted,
  emitMeetingSummaryOutcomeRecorded,
  emitMeetingSummaryResultPublished,
  emitMeetingSummaryUpdated,
} from "./events.js";

export const AI_ATTRIBUTION_LABEL =
  "AI-generated, admin-reviewed. Not an authoritative transcript.";

// --- State creation --------------------------------------------------------

/**
 * Build the initial MeetingSummaryProcessState from a completed pipeline
 * run. `civic.process.created` is auto-emitted by processService; the
 * module emits aggregation_completed via emitCreationEvents() below.
 */
export function createMeetingSummaryState(
  input: CreateMeetingSummaryInput,
): MeetingSummaryProcessState {
  const now = new Date().toISOString();
  return {
    type: "civic.meeting_summary",
    source_id: input.source_id,
    source_minutes_url: input.source_minutes_url,
    source_agenda_url: input.source_agenda_url,
    source_type: input.source_type,
    source_video_url: input.source_video_url,
    additional_video_urls: [...input.additional_video_urls],
    meeting_title: input.meeting_title,
    meeting_date: input.meeting_date,
    blocks: sanitizeBlocks(input.blocks),
    approval_status: "pending",
    generated_at: now,
    approved_at: null,
    published_at: null,
    admin_notes: "",
    last_edited_at: null,
    edit_count: 0,
    pending_revision: null,
    revised_at: null,
    ai_instructions_used: input.ai_instructions_used,
    ai_model: input.ai_model,
    ai_attribution_label: AI_ATTRIBUTION_LABEL,
  };
}

/**
 * Emit the creation events. Called by the host hub once the process row
 * is persisted. civic.process.created is auto-emitted by
 * processService.createProcess(); we only emit aggregation_completed
 * here.
 */
export async function emitCreationEvents(
  ctx: MeetingSummaryProcessContext,
  actor: string,
  state: MeetingSummaryProcessState,
): Promise<void> {
  await emitMeetingSummaryAggregationCompleted(ctx, actor, state);
}

// --- Edits -----------------------------------------------------------------

/**
 * Apply an admin edit to a meeting summary. Rejects if not in pending
 * status. Emits civic.process.updated per edit.
 */
export async function editMeetingSummary(
  state: MeetingSummaryProcessState,
  actor: string,
  patch: MeetingSummaryPatch,
  ctx: MeetingSummaryProcessContext,
): Promise<MeetingSummaryProcessState> {
  if (!canEdit(state)) {
    throw new Error(
      `Meeting summary cannot be edited: approval_status is "${state.approval_status}"`,
    );
  }

  const editedFields: string[] = [];
  if (
    typeof patch.meeting_title === "string" &&
    patch.meeting_title !== state.meeting_title
  ) {
    state.meeting_title = patch.meeting_title.trim().slice(0, 200);
    editedFields.push("meeting_title");
  }
  if (Array.isArray(patch.blocks)) {
    state.blocks = sanitizeBlocks(patch.blocks);
    editedFields.push("blocks");
  }
  if (typeof patch.admin_notes === "string") {
    state.admin_notes = patch.admin_notes;
    editedFields.push("admin_notes");
  }

  if (editedFields.length === 0) {
    // No-op: do not bump counters, do not emit.
    return state;
  }

  state.edit_count += 1;
  state.last_edited_at = new Date().toISOString();
  await emitMeetingSummaryUpdated(ctx, actor, state, editedFields);

  return state;
}

// --- Approval orchestration ------------------------------------------------

/**
 * Run the approval sequence. Mutations happen on the passed-in state
 * object; the caller persists after the promise resolves.
 *
 * Sequence (Civic Process Spec Phases 5 → 6):
 *   1. approval_status = approved, approved_at = now
 *   2. emit outcome_recorded (outcome_type = "informational")
 *   3. approval_status = published, published_at = now
 *   4. emit result_published
 *
 * Simpler than approveBrief — no email delivery, no linked-vote step.
 */
export async function approveMeetingSummary(
  state: MeetingSummaryProcessState,
  actor: string,
  ctx: MeetingSummaryProcessContext,
): Promise<MeetingSummaryProcessState> {
  if (!canApprove(state)) {
    throw new Error(
      `Meeting summary cannot be approved: approval_status is "${state.approval_status}"`,
    );
  }

  // Step 1: transition to approved
  assertApprovalTransition(state.approval_status, "approved");
  state.approval_status = "approved";
  state.approved_at = new Date().toISOString();

  // Step 2: outcome recorded (Phase 5)
  await emitMeetingSummaryOutcomeRecorded(ctx, actor, state);

  // Step 3: transition to published
  assertApprovalTransition(state.approval_status, "published");
  state.approval_status = "published";
  state.published_at = new Date().toISOString();

  // Step 4: result published (Phase 6)
  await emitMeetingSummaryResultPublished(ctx, actor, state);

  return state;
}

// --- Read models -----------------------------------------------------------

export function getAdminReadModel(
  state: MeetingSummaryProcessState,
  processMeta: {
    id: string;
    title: string;
    createdAt: string;
    createdBy: string;
  },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.meeting_summary",
    title: processMeta.title,
    meeting_title: state.meeting_title,
    meeting_date: state.meeting_date,
    source_id: state.source_id,
    source_minutes_url: state.source_minutes_url,
    source_agenda_url: state.source_agenda_url ?? null,
    source_type: state.source_type ?? "minutes",
    source_video_url: state.source_video_url,
    additional_video_urls: state.additional_video_urls,
    blocks: state.blocks,
    approval_status: state.approval_status,
    generated_at: state.generated_at,
    approved_at: state.approved_at,
    published_at: state.published_at,
    admin_notes: state.admin_notes,
    last_edited_at: state.last_edited_at,
    edit_count: state.edit_count,
    pending_revision: state.pending_revision ?? null,
    revised_at: state.revised_at ?? null,
    ai_instructions_used: state.ai_instructions_used,
    ai_model: state.ai_model,
    ai_attribution_label: state.ai_attribution_label,
    created_at: processMeta.createdAt,
    created_by: processMeta.createdBy,
  };
}

/**
 * Public read model (published summaries only). Excludes the admin-only
 * instructions-used snapshot.
 */
export function getPublicReadModel(
  state: MeetingSummaryProcessState,
  processMeta: { id: string; title: string; createdAt: string },
): Record<string, unknown> | null {
  if (state.approval_status !== "published") return null;
  return {
    id: processMeta.id,
    type: "civic.meeting_summary",
    title: processMeta.title,
    meeting_title: state.meeting_title,
    meeting_date: state.meeting_date,
    source_minutes_url: state.source_minutes_url,
    source_agenda_url: state.source_agenda_url ?? null,
    source_type: state.source_type ?? "minutes",
    source_video_url: state.source_video_url,
    additional_video_urls: state.additional_video_urls,
    blocks: state.blocks,
    admin_notes: state.admin_notes,
    generated_at: state.generated_at,
    published_at: state.published_at,
    // Lets the public page say what is still missing, and note a revision.
    // Deliberately not the revision itself — unreviewed text is never public.
    awaiting_minutes: !state.source_minutes_url,
    revised_at: state.revised_at ?? null,
    ai_model: state.ai_model,
    ai_attribution_label: state.ai_attribution_label,
  };
}

/**
 * Attach a regenerated summary for review without disturbing the live one.
 *
 * Replaces any revision already waiting: a newer regeneration supersedes an
 * older one that nobody got to, and keeping a queue of them would mean
 * reviewing the same meeting repeatedly.
 */
export function stageRevision(
  state: MeetingSummaryProcessState,
  revision: MeetingSummaryRevision,
): MeetingSummaryProcessState {
  state.pending_revision = revision;
  return state;
}

/**
 * Accept the waiting revision: its content becomes the live summary.
 *
 * Publication state is untouched — the summary was published before and stays
 * published, so no page ever goes dark and no second publication event fires.
 * `revised_at` is what the UI renders as "Updated".
 */
export function acceptRevision(
  state: MeetingSummaryProcessState,
  now: string = new Date().toISOString(),
): MeetingSummaryProcessState {
  const rev = state.pending_revision;
  if (!rev) throw new Error("No revision is waiting for review");

  state.blocks = rev.blocks;
  state.source_minutes_url = rev.source_minutes_url;
  state.source_agenda_url = rev.source_agenda_url;
  state.source_video_url = rev.source_video_url;
  state.additional_video_urls = rev.additional_video_urls;
  state.source_type = rev.source_type;
  state.ai_instructions_used = rev.ai_instructions_used;
  state.ai_model = rev.ai_model;
  state.generated_at = rev.generated_at;
  state.revised_at = now;
  state.pending_revision = null;
  return state;
}

/** Drop the waiting revision. The live summary continues unchanged. */
export function discardRevision(
  state: MeetingSummaryProcessState,
): MeetingSummaryProcessState {
  if (!state.pending_revision) {
    throw new Error("No revision is waiting for review");
  }
  state.pending_revision = null;
  return state;
}

export function getAdminSummary(
  state: MeetingSummaryProcessState,
  processMeta: { id: string; title: string; createdAt: string },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.meeting_summary",
    title: processMeta.title,
    meeting_title: state.meeting_title,
    meeting_date: state.meeting_date,
    approval_status: state.approval_status,
    block_count: state.blocks.length,
    has_video: state.source_video_url !== null,
    source_type: state.source_type ?? "minutes",
    generated_at: state.generated_at,
    approved_at: state.approved_at,
    published_at: state.published_at,
    edit_count: state.edit_count,
    pending_revision: state.pending_revision ?? null,
    revised_at: state.revised_at ?? null,
    created_at: processMeta.createdAt,
  };
}

// --- Helpers ---------------------------------------------------------------

function sanitizeBlocks(raw: SummaryBlock[]): SummaryBlock[] {
  const out: SummaryBlock[] = [];
  for (const block of raw ?? []) {
    if (!block || typeof block !== "object") continue;
    const topic_title =
      typeof block.topic_title === "string" ? block.topic_title.trim() : "";
    const topic_summary =
      typeof block.topic_summary === "string" ? block.topic_summary.trim() : "";
    if (topic_title.length === 0 && topic_summary.length === 0) continue;
    const start =
      typeof block.start_time_seconds === "number" &&
      Number.isFinite(block.start_time_seconds) &&
      block.start_time_seconds >= 0
        ? Math.round(block.start_time_seconds)
        : null;
    const action =
      typeof block.action_taken === "string" && block.action_taken.trim().length > 0
        ? block.action_taken.trim()
        : null;
    out.push({
      topic_title: topic_title.slice(0, 200),
      topic_summary: topic_summary.slice(0, 4000),
      start_time_seconds: start,
      action_taken: action ? action.slice(0, 1000) : null,
    });
  }
  return out;
}

/**
 * Build a short blurb from the first few block titles for process
 * descriptions / discovery manifests. Keeps feed + federation metadata
 * meaningful without a second fetch.
 */
export function buildProcessDescription(blocks: SummaryBlock[]): string {
  const titles = blocks
    .slice(0, 4)
    .map((b) => b.topic_title.trim())
    .filter((t) => t.length > 0);
  if (titles.length === 0) return "";
  return titles.join(" · ");
}
