// Meeting summaries' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): the public page's read, and the admins'
// review queue under /admin/meeting-summaries.

import { apiRequest } from "@civic-social/plugin-sdk/ui";

export type MeetingSummaryApprovalStatus = "pending" | "approved" | "published";

/**
 * What a summary was built from. "recording" means the video transcript
 * alone — the shape the youtube-channel connector produces, since a channel
 * feed carries no minutes or agenda PDF.
 */
export type MeetingSourceType = "minutes" | "agenda" | "recording";

export interface SummaryBlock {
  topic_title: string;
  topic_summary: string;
  start_time_seconds: number | null;
  action_taken: string | null;
}

/**
 * Why a summary must not be published without an admin looking first —
 * today, missing video timestamps. Shape: ../readiness.ts.
 */
export interface SummaryQualityFlag {
  kind: "timestamps_missing" | "transcript_unavailable";
  message: string;
  detail: string | null;
  flagged_at: string;
}

/** Admin list row. */
export interface MeetingSummarySummary {
  id: string;
  type: "civic.meeting_summary";
  title: string;
  meeting_title: string;
  meeting_date: string;
  approval_status: MeetingSummaryApprovalStatus;
  block_count: number;
  has_video: boolean;
  source_type: MeetingSourceType;
  generated_at: string;
  approved_at: string | null;
  published_at: string | null;
  edit_count: number;
  created_at: string;
  /** Set when a regenerated summary is waiting for review. */
  pending_revision?: { generated_at: string; quality_flag?: SummaryQualityFlag | null } | null;
  /** Set when the summary needs a check before publishing. */
  quality_flag?: SummaryQualityFlag | null;
}

/** Admin detail (full read). */
export interface MeetingSummaryDetail extends MeetingSummarySummary {
  source_id: string;
  source_minutes_url: string | null;
  source_agenda_url: string | null;
  source_type: MeetingSourceType;
  source_video_url: string | null;
  additional_video_urls: string[];
  blocks: SummaryBlock[];
  admin_notes: string;
  last_edited_at: string | null;
  ai_instructions_used: string;
  ai_model: string;
  ai_attribution_label: string;
  created_by: string;
  /** A regenerated summary awaiting review, held beside the published one. */
  pending_revision?: {
    blocks: SummaryBlock[];
    source_minutes_url: string | null;
    source_video_url: string | null;
    source_type: MeetingSourceType;
    reason: string;
    generated_at: string;
    quality_flag?: SummaryQualityFlag | null;
  } | null;
  revised_at?: string | null;
}

/** Public payload — only returned for published summaries. */
export interface PublicMeetingSummary {
  id: string;
  type: "civic.meeting_summary";
  title: string;
  meeting_title: string;
  meeting_date: string;
  source_minutes_url: string | null;
  source_agenda_url: string | null;
  source_type: MeetingSourceType;
  source_video_url: string | null;
  additional_video_urls: string[];
  blocks: SummaryBlock[];
  admin_notes: string;
  /** True while no official minutes have been published for this meeting. */
  awaiting_minutes?: boolean;
  /** ISO 8601 — when a revision was last accepted. Null if never revised. */
  revised_at?: string | null;
  generated_at: string;
  published_at: string;
  ai_model: string;
  ai_attribution_label: string;
  /** Sample content (Phase 7): written by hand, no recording behind it. */
  is_sample?: boolean;
  /** A sample's minutes, as plain text (2026-10-07); paragraphs split on blank lines. */
  sample_minutes?: string;
}

export interface MeetingSummaryPatch {
  meeting_title?: string;
  blocks?: SummaryBlock[];
  admin_notes?: string;
}

export function adminListMeetingSummaries(
  status?: MeetingSummaryApprovalStatus,
): Promise<MeetingSummarySummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest("GET", `/admin/meeting-summaries${params}`);
}

export function adminGetMeetingSummary(
  id: string,
): Promise<MeetingSummaryDetail> {
  return apiRequest("GET", `/admin/meeting-summaries/${id}`);
}

export function adminPatchMeetingSummary(
  id: string,
  patch: MeetingSummaryPatch,
): Promise<MeetingSummaryDetail> {
  return apiRequest("PATCH", `/admin/meeting-summaries/${id}`, patch);
}

/**
 * A flagged summary (quality_flag set) is refused with 409 unless
 * `confirmFlagged` says the admin has seen the flag and chose to publish.
 */
export function adminApproveMeetingSummary(
  id: string,
  opts?: { confirmFlagged?: boolean },
): Promise<{ message: string; meeting_summary: MeetingSummaryDetail }> {
  return apiRequest("POST", `/admin/meeting-summaries/${id}/approve`, {
    confirm_flagged: opts?.confirmFlagged === true,
  });
}

export function adminBatchApproveMeetingSummaries(
  ids: string[],
  opts?: { backdate?: boolean },
): Promise<{
  message: string;
  published: number;
  skipped: number;
  /** Flagged summaries are never batch-approved; each needs its own confirmation. */
  flagged_skipped?: number;
  failed: number;
}> {
  return apiRequest("POST", `/admin/meeting-summaries/batch-approve`, {
    ids,
    backdate: opts?.backdate ?? false,
  });
}

/** Accept the waiting revision — its content becomes the live summary. */
export function adminAcceptMeetingSummaryRevision(
  id: string,
  opts?: { confirmFlagged?: boolean },
): Promise<{ message: string; meeting_summary: MeetingSummaryDetail }> {
  return apiRequest("POST", `/admin/meeting-summaries/${id}/revision/accept`, {
    confirm_flagged: opts?.confirmFlagged === true,
  });
}

/** Drop the waiting revision. The published summary continues unchanged. */
export function adminDiscardMeetingSummaryRevision(
  id: string,
): Promise<{ message: string; meeting_summary: MeetingSummaryDetail }> {
  return apiRequest("POST", `/admin/meeting-summaries/${id}/revision/discard`);
}

export function adminBatchDeleteMeetingSummaries(
  ids: string[],
): Promise<{ message: string; deleted: number; archived?: number; skipped: number }> {
  // Soft-archive (restorable), not hard-delete — see the backend handler.
  return apiRequest("POST", `/admin/meeting-summaries/batch-delete`, { ids });
}

export function getMeetingSummary(id: string): Promise<PublicMeetingSummary> {
  return apiRequest("GET", `/meeting-summary/${id}`);
}
