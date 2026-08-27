// civic.meeting_summary module — type definitions
//
// A Meeting Summary is an AI-generated, admin-reviewed summary of a
// jurisdiction's official meeting (e.g. a Board of Supervisors meeting).
// The summary is produced by combining the meeting's minutes PDF with its
// YouTube auto-transcript into a structured list of topic blocks with
// timestamp links into the video recording.
//
// Meeting summaries are simultaneously:
//   - a process-type module (registered in the process registry, storing
//     state, emitting lifecycle events), and
//   - a service module (the scraper + summarizer pipeline invoked by cron).
//
// Both halves live under this folder; they're distinguished by filename:
//   service.ts    — state transitions (process-type work)
//   pipeline.ts   — cron-scraping flow (service work)
//   connectors/*  — pluggable source discovery
//
// Pluggability guardrail: this module MUST NOT import from the hub's event
// store, DB client, routes layer, or any other module (civic.vote,
// civic.brief, civic.digest, etc.). The host hub injects every effectful
// dependency. A hub that doesn't want meeting summaries simply doesn't
// register the module and doesn't mount its routes.

// --- Core data model --------------------------------------------------------

export type MeetingSummaryApprovalStatus = "pending" | "approved" | "published";

/**
 * Which source a summary was built from. See MeetingSummaryProcessState
 * for the authority ordering and the upgrade rules.
 */
export type MeetingSourceType = "minutes" | "agenda" | "recording";

/** Source types a later minutes-bearing run is allowed to re-summarize. */
export const UPGRADEABLE_SOURCE_TYPES: readonly MeetingSourceType[] = [
  "agenda",
  "recording",
];

/**
 * A single topic block — one segment of the meeting. `start_time_seconds`
 * points into the YouTube recording for click-to-jump UX. `action_taken`
 * captures any motion / vote / decision distinct from the discussion.
 *
 * When the meeting has no video recording (e.g. "Video recording
 * unavailable"), `start_time_seconds` is null and the UI renders the block
 * without a clickable timestamp.
 */
export interface SummaryBlock {
  topic_title: string;
  topic_summary: string;
  start_time_seconds: number | null;
  action_taken: string | null;
}

/**
 * A regenerated summary awaiting review, held beside the published one.
 *
 * WHY A REVISION RATHER THAN A STATUS ROUND-TRIP
 * Better sources arrive late: a jurisdiction publishes the recording within a
 * day and the official minutes weeks later. The improved summary must still be
 * reviewed before residents see it — but sending the record back to "pending"
 * clears `published_at`, and an unpublished summary serves nothing, so the live
 * page would 404 for as long as the queue went untouched. That happened.
 *
 * So the published version stays exactly where it is and the candidate waits
 * here. Approving swaps it in; discarding drops it and leaves v1 serving.
 */
export interface MeetingSummaryRevision {
  blocks: SummaryBlock[];
  source_minutes_url: string | null;
  source_agenda_url: string | null;
  source_type: MeetingSourceType;
  /** What this revision adds over the live version, for the review screen. */
  reason: string;
  ai_instructions_used: string;
  ai_model: string;
  /** ISO 8601 — when the revision was generated. */
  generated_at: string;
}

/**
 * Process.state shape for a civic.meeting_summary process.
 *
 * The process-level `status` field (active | finalized) mirrors the
 * civic.brief convention — draft → active → finalized, with "closed" and
 * "draft" skipped because the process has no participation window. See
 * HANDOFF.md for the deviation note (cross-referenced to the existing
 * brief note).
 */
export interface MeetingSummaryProcessState {
  type: "civic.meeting_summary";

  // --- Source provenance (the "what was summarized" contract) ---
  /**
   * Canonical dedupe key produced by the connector. Typically the PDF URL,
   * but connectors may choose a stable alternative (e.g. a hash). The cron
   * looks for an existing process with this source_id before creating a
   * new summary.
   */
  source_id: string;
  /** PDF URL of the minutes document. Null when only an agenda was available. */
  source_minutes_url: string | null;
  /** PDF URL of the agenda document. Null when the page didn't list one. */
  source_agenda_url: string | null;
  /**
   * What the summary was built from, in descending order of authority:
   *   "minutes"   — the official minutes PDF (plus transcript if present)
   *   "agenda"    — the agenda PDF (plus transcript if present)
   *   "recording" — the video transcript alone, no document at all
   *
   * "recording" is what the youtube-channel connector produces: a channel
   * feed carries no PDFs. Both "agenda" and "recording" are provisional
   * and get re-summarized by the cron's upgrade pass if minutes for the
   * same date turn up later.
   */
  source_type: MeetingSourceType;
  /**
   * YouTube watch URL of the primary recording. Null when the meeting
   * has no video recording (e.g. streaming failure, PDF-only workshop).
   * In that case blocks carry null start_time_seconds and the public
   * page shows a modified disclaimer.
   */
  source_video_url: string | null;
  /**
   * Secondary recordings (segment 2, retry after stream drop, etc.).
   * Displayed on the public page for transparency but NOT used for
   * transcript fetch or summarization in MVP. Full-meeting coverage is
   * a future enhancement — flagged in HANDOFF.md.
   */
  additional_video_urls: string[];
  meeting_title: string;
  /** ISO 8601 date (YYYY-MM-DD). */
  meeting_date: string;

  // --- Aggregated output ---
  blocks: SummaryBlock[];

  // --- Admin review + approval tracking ---
  approval_status: MeetingSummaryApprovalStatus;
  /** ISO 8601 — pipeline completion time. */
  generated_at: string;
  approved_at: string | null;
  published_at: string | null;
  /** Optional admin-authored context; empty string on generation. */
  admin_notes: string;
  /** Null if never edited. */
  last_edited_at: string | null;
  /** Increments on each admin edit during review. */
  edit_count: number;
  /**
   * A regenerated summary awaiting review. Null when there is none. Only ever
   * set on a summary that is already published — an unpublished one has no
   * live version to protect, so it is replaced directly.
   */
  pending_revision: MeetingSummaryRevision | null;
  /** ISO 8601 — when a revision was last accepted. Null if never revised. */
  revised_at: string | null;

  // --- Provenance / reproducibility ---
  /** Snapshot of the admin extraction instructions at generation time. */
  ai_instructions_used: string;
  /** Anthropic model name, e.g. "claude-sonnet-4-5-20251022". */
  ai_model: string;
  /**
   * The "AI-generated, admin-reviewed..." disclaimer text stored with
   * the summary so federated consumers see it without relying on UI
   * chrome.
   */
  ai_attribution_label: string;
}

// --- Module inputs ----------------------------------------------------------

/** Input the pipeline passes when creating a summary from a completed run. */
export interface CreateMeetingSummaryInput {
  source_id: string;
  source_minutes_url: string | null;
  source_agenda_url: string | null;
  source_type: MeetingSourceType;
  source_video_url: string | null;
  additional_video_urls: string[];
  meeting_title: string;
  meeting_date: string;
  blocks: SummaryBlock[];
  ai_instructions_used: string;
  ai_model: string;
}

/** Partial update body used by PATCH /admin/meeting-summaries/:id. */
export interface MeetingSummaryPatch {
  meeting_title?: string;
  blocks?: SummaryBlock[];
  admin_notes?: string;
}

// --- Context + injected callback types -------------------------------------

export interface MeetingSummaryProcessContext {
  process_id: string;
  hub_id: string;
  jurisdiction: string;
  emit: EmitEventFn;
}

export interface EmitEventFn {
  (input: {
    event_type: string;
    actor: string;
    process_id: string;
    hub_id: string;
    jurisdiction: string;
    data: Record<string, unknown>;
    /** Phase 3 — canonical process type, stamped into data.process.type. */
    processType?: string;
    action_url_path?: string;
    timestamp?: string;
  }): Promise<unknown>;
}

export interface FetchHtmlFn {
  (url: string): Promise<string>;
}

/** Fetch an RSS/Atom feed (or any XML body) as a string. */
export interface FetchXmlFn {
  (url: string): Promise<string>;
}

/**
 * Fetch (or POST to) a JSON endpoint. Needed by connectors that read a
 * site's CMS/data API rather than its rendered HTML.
 */
export interface FetchJsonFn {
  (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<unknown>;
}

export interface FetchPdfFn {
  (url: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

export interface TranscriptSegment {
  /** Seconds into the video. */
  start: number;
  text: string;
}

export interface FetchYouTubeTranscriptFn {
  (videoUrl: string): Promise<TranscriptSegment[]>;
}

/**
 * Low-level Claude call used by both the extraction and the summarization
 * legs. `system` is optional; `documentBase64` is provided for the
 * summarization leg to pass the PDF as a native document block. Returns
 * the assistant's raw text output plus the model id actually used (echoed
 * by the API).
 */
export interface CallClaudeFn {
  (input: {
    model: string;
    system?: string;
    userText: string;
    documentBase64?: { data: string; mediaType: string; filename?: string };
    maxTokens?: number;
  }): Promise<{ text: string; model: string }>;
}

// --- Configuration ---------------------------------------------------------

export interface MeetingSummaryConfig {
  /**
   * Jurisdiction's minutes page URL (e.g. Floyd's agendas-minutes page).
   * Required by HTML-scraping connectors; empty for feed-based ones.
   */
  source_url: string;
  /**
   * YouTube channel id (UC…) for the youtube-channel connector. Ignored
   * by connectors that don't read a channel feed.
   */
  channel_id?: string;
  /**
   * Comma-separated, case-insensitive substrings. A discovered meeting is
   * kept when its title contains ANY of them; empty keeps everything.
   * Lets one channel carrying several bodies' recordings be narrowed to
   * the one this hub publishes summaries for.
   */
  title_filter?: string;
  /**
   * Comma-separated, case-insensitive substrings. A discovered meeting is
   * DROPPED when its title contains any of them. Applied after title_filter.
   *
   * The complement of title_filter, and the better tool when a source is
   * already almost entirely the right body: Floyd's agendas collection is
   * all Board of Supervisors business except a handful of EMS Board rows,
   * so one exclusion is more robust than trying to enumerate every valid
   * meeting-type name ("Regular Meeting", "Budget Workshop Meeting",
   * "Special Called Meeting", "Public Hearing …", and 23 more).
   */
  type_exclude?: string;
  /**
   * CMS collection to read, for data-API connectors (wix-cms). Optional —
   * the connector discovers it from the page when unset.
   */
  collection_name?: string;
  /**
   * Admin-provided natural-language guidance. Prepended verbatim to the
   * Claude extraction and summarization prompts. A short built-in
   * fallback is used when this is empty.
   */
  extraction_instructions: string;
  /** Anthropic model name to use for both prompts. */
  model: string;
}

// --- Connector interface ---------------------------------------------------

/**
 * Output of a connector's discover() call. A connector enumerates every
 * meeting that exists on its source; the cron then dedupes by source_id
 * before creating processes.
 */
export interface MeetingEntry {
  meeting_title: string;
  /** ISO 8601 date (YYYY-MM-DD). */
  meeting_date: string;
  /** Minutes PDF URL. Null when only an agenda is available. */
  source_minutes_url: string | null;
  /** Agenda PDF URL. Null when the page didn't list one separately. */
  source_agenda_url: string | null;
  /** Null if the meeting has no video recording. */
  source_video_url: string | null;
  /** Non-empty if the meeting has multiple recordings (segment 2, etc.). */
  additional_video_urls: string[];
  /** Stable dedupe key. Derived from meeting date + title. */
  source_id: string;
}

export interface MeetingSourceConnector {
  id: string;
  description: string;
  discover(
    cfg: MeetingSummaryConfig,
    deps: {
      fetchHtml: FetchHtmlFn;
      fetchXml: FetchXmlFn;
      fetchJson: FetchJsonFn;
      callClaude: CallClaudeFn;
    },
  ): Promise<MeetingEntry[]>;
}

// --- Pipeline output -------------------------------------------------------

export interface SummarizeMeetingResult {
  blocks: SummaryBlock[];
  ai_instructions_used: string;
  model: string;
  sourceType: MeetingSourceType;
}
