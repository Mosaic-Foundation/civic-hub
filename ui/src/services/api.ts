/**
 * API service — thin fetch wrapper for the Civic Hub backend.
 * All display data comes from read-layer endpoints.
 * Actions go through the internal process action endpoint.
 */

import type { SubmissionField } from "../../../src/shared/submissionPreview";
import { request, upload } from "./http";
import { askAboutYouFirst } from "./aboutYou";

/** An address a published item was not emailed to, and why. */
export interface HeldBackRecipient {
  email: string;
  reason: string;
}

// Every call goes through services/http.ts request(). Reads are not cached
// here: a component reads through useApi (hooks/useApi.ts), whose 30-second
// cache the list pages opt into.

// --- Structured content types ---

export interface CommunityInputConfig {
  prompt?: string;
  label: string;
  /** Which phases to show; default every phase except "update". */
  phases?: CommentPhase[];
  /** Section heading; default "Community comments". */
  heading?: string;
  /** Noun for the count line; default "comment". */
  noun?: string;
  /** Shown instead of nothing when the list is empty. */
  emptyText?: string;
  /** Render bodies as Markdown (creator updates are written with the toolbar). */
  richText?: boolean;
}

export type CommentPhase = "proposal" | "vote" | "comment" | "update";

// --- Status types ---

export type ProposalProcessStatus = "open" | "closed";

// --- Read layer (UI-facing) ---

/** Shared base for all process summaries */
export interface ProcessSummaryBase {
  id: string;
  type: string;
  title: string;
  status: string;
  created_at: string;
  // Raw id is redacted server-side on public responses (always ""). Use
  // creator_name / creator_is_admin for attribution.
  created_by: string;
  /** Resolved display name of the creator (full_name ?? display_name ?? "Resident"). */
  creator_name: string;
  /** Whether the creator is a hub admin (email in CIVIC_ADMIN_EMAILS). */
  creator_is_admin: boolean;
  /**
   * The author's public office, when an admin has designated one on their
   * account. Both null for residents. The TITLE renders as its own pill
   * next to the name (see Creator); the TYPE only selects its colour.
   * Independent of creator_is_admin — an account can carry both.
   */
  creator_official_type: string | null;
  creator_official_title: string | null;
  /** Seeded sample content (Phase 7): present and true when this process was
   *  planted by the sample-content seeder; absent otherwise. */
  is_sample?: boolean;
}

/** Proposal summary (from GET /process list) */
export interface ProposalSummary extends ProcessSummaryBase {
  type: "civic.proposal";
  status: ProposalProcessStatus;
  support_count: number;
  support_threshold: number;
}

/** Another type's list row: the shared fields, and the type's own (its package types them). */
export interface OtherProcessSummary extends ProcessSummaryBase {
  [field: string]: unknown;
}

export type ProcessSummary = ProposalSummary | OtherProcessSummary;

/** Proposal detail state */
export interface ProposalState {
  id: string;
  type: "civic.proposal";
  title: string;
  description: string;
  status: ProposalProcessStatus;
  proposed_options: string[];
  support_count: number;
  support_threshold: number;
  has_supported: boolean | null;
  promoted_vote_id: string | null;
  created_at: string;
  created_by: string;
  creator_name: string;
  creator_is_admin: boolean;
  /**
   * The author's public office, when an admin has designated one on their
   * account. Both null for residents. The TITLE renders as its own pill
   * next to the name (see Creator); the TYPE only selects its colour.
   * Independent of creator_is_admin — an account can carry both.
   */
  creator_official_type: string | null;
  creator_official_title: string | null;
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/** Another type's state as GET /process/:id/state reads it: its read model, typed by its package. */
export interface OtherProcessState {
  id: string;
  type: string;
  title: string;
  status: string;
  [field: string]: unknown;
}

export type ProcessState = ProposalState | OtherProcessState;

export function listProcesses(types?: string[]): Promise<ProcessSummary[]> {
  if (types && types.length > 0) {
    const qs = new URLSearchParams();
    for (const t of types) qs.append("type", t);
    return request("GET", `/process?${qs.toString()}`);
  }
  return request("GET", "/process");
}

export function getProcessState(id: string): Promise<ProcessState> {
  // The caller's identity rides on the Bearer token (request() attaches
  // it) — the server resolves per-actor fields (has_voted) from the
  // session, never from a query param.
  return request("GET", `/process/${id}/state`);
}

// --- Actions (internal control surface) ---

/**
 * What every process action answers: its own result, and `view`, the process
 * exactly as this caller's next GET /process/:id/state reads it (null when
 * they may no longer read it). A page sets its state to `view`, so the result
 * shows at once, with no reload.
 */
export interface ActionResult<V = ProcessState> {
  result: Record<string, unknown>;
  view: V | null;
}

/** Close early (an admin, before the deadline): what a page's read model offers. */
export interface EarlyCloseOffer {
  action: string;
  deadline: string;
}

/** A process closed before its deadline: the line pages show, and the admin's note. */
export interface ClosedEarly {
  at: string;
  original_deadline: string;
  note: string;
  line: string;
}

/** Close a process early, with the admin's note (required). */
export function closeEarly<V = ProcessState>(processId: string, action: string, note: string): Promise<ActionResult<V>> {
  return request("POST", `/process/${processId}/action`, { type: action, payload: { note } });
}

// --- Drafting assistant (shared across process types) ---
//
// One API surface for every process type: /assistant/:processType/...
// dispatches through the backend registry. Which types have an assistant
// (and their greetings + per-field guidance) comes from the config call.

export type DraftCategory = "issue" | "idea" | "project" | "concern";
export type DraftPhase = "brainstorm" | "review" | "free_form";

export interface DraftSuggestion {
  severity: "soft" | "hard";
  quoted_text: string | null;
  field: "title" | "description" | "sources" | "considerations" | "seed_statements" | "options" | null;
  message: string;
  suggested_revision: string | null;
  /** Stored when the Code of Conduct check could not run. */
  check_unavailable?: true;
}

export interface AssistantFieldGuidance {
  field: "title" | "description" | "sources" | "considerations" | "seed_statements";
  hint: string;
  example?: string;
}

export interface AssistantUiConfig {
  available: boolean;
  content_noun?: string;
  greeting?: string;
  returning_greeting?: string;
  kickoff_message?: string;
  supports_categories?: boolean;
  field_guidance: AssistantFieldGuidance[];
}

export function getAssistantUiConfig(
  processType: string,
): Promise<AssistantUiConfig> {
  return request("GET", `/assistant/${processType}/config`);
}

/** One assistant conversation turn for a draft of any process type. */
export function sendAssistantMessage<D>(
  processType: string,
  draftId: string,
  phase: DraftPhase,
  userMessage: string,
): Promise<{ response: AssistantResponse; draft: D; review_unavailable?: boolean }> {
  return request("POST", `/assistant/${processType}/drafts/${draftId}/message`, {
    phase,
    user_message: userMessage,
  });
}

/** "Get suggestions": the best-practices review, on request, for a draft of any type. */
export function suggestForDraft<D>(
  processType: string,
  draftId: string,
): Promise<{ response: AssistantResponse; draft: D }> {
  return request("POST", `/assistant/${processType}/drafts/${draftId}/suggest`);
}

// --- Proposal Drafts ---

export interface AssistantResponse {
  message: string;
  suggestions: DraftSuggestion[];
  draft_proposal: {
    title: string;
    description: string;
    sources: string;
    considerations: string;
  } | null;
}

/**
 * Result of creating any reviewable process. Creation always flows through the
 * one path: submit for review, then auto-approve when the creator is an admin.
 * `auto_approved` tells the UI whether the process is already live (navigate to
 * its detail page) or pending review (navigate to My Submissions).
 */
export interface CreateProcessResult {
  review_id: string;
  process_id: string;
  auto_approved: boolean;
  /** Sent to the admins with what the Code of Conduct check flagged. */
  flagged?: boolean;
  /** The check couldn't run, so an admin reads it first. */
  check_unavailable?: boolean;
}

/** Passing `review_id` turns a submit into a revision of that review (after
 *  an admin requested changes): the process is updated in place and goes
 *  back into the queue instead of a second process being created. */
export interface SubmitDraftOptions {
  review_id?: string;
  /** Edit of a LIVE process (from "Edit project"): apply in place, record, notify. */
  edit_process_id?: string;
  /** "Think this is wrong? Tell the admins": send text the check flagged to the review queue. */
  tell_admins?: boolean;
  /** The resident's note to the admins with a flagged submission. */
  note?: string;
}

/** The drafting kinds, each at its own path on the server (one router, src/routes/draftRoutes.ts). */
export type DraftKindName = "proposal" | "vote" | "project" | "conversation";

const DRAFT_PATHS: Record<DraftKindName, string> = {
  proposal: "/proposals/drafts",
  vote: "/votes/drafts",
  project: "/projects/drafts",
  conversation: "/deliberations/drafts",
};

export interface DraftApi<D> {
  create(body?: Record<string, unknown>): Promise<D>;
  list(): Promise<D[]>;
  get(id: string): Promise<D>;
  update(id: string, patch: Record<string, unknown>): Promise<D>;
  submit(id: string, opts?: SubmitDraftOptions): Promise<CreateProcessResult>;
}

/** One drafts client for every kind (Audit 3): create, list, read, edit, submit. */
export function draftApi<D>(kind: DraftKindName): DraftApi<D> {
  const base = DRAFT_PATHS[kind];
  return {
    create: (body) => request("POST", base, body),
    list: () => request("GET", base),
    get: (id) => request("GET", `${base}/${id}`),
    update: (id, patch) => request("PATCH", `${base}/${id}`, patch),
    // Submitting a draft is taking part: the one-time About-you card first.
    submit: async (id, opts) => {
      await askAboutYouFirst();
      return request("POST", `${base}/${id}/submit`, opts ?? {});
    },
  };
}

// --- Creator edits of a live process (universal /process/:id routes) ---

export interface EditPolicy {
  editable: boolean;
  locked_fields: string[];
  reason?: string;
}

export interface ProcessEdit {
  id: string;
  at: string;
  editor_role: "creator" | "admin";
  changed_fields: string[];
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
}

export function getEditPolicy(processId: string): Promise<EditPolicy> {
  return request("GET", `/process/${processId}/edit-policy`);
}

export function startProcessEdit(
  processId: string,
): Promise<{ draft_id: string; draft_path: string; locked_fields: string[] }> {
  return request("POST", `/process/${processId}/edit`);
}

export function listProcessEdits(processId: string): Promise<{ edits: ProcessEdit[] }> {
  return request("GET", `/process/${processId}/edits`);
}

// --- Vote Drafts (AI-augmented vote drafting) ---

// --- Admin: Proposal Review ---

/** List proposals for admin review */
// --- Community Input ---

export interface CommunityInput {
  id: string;
  process_id: string;
  /** Empty string for non-admin callers — the server redacts it. */
  author_id: string;
  /** Real-name snapshot at post time; null for anonymous / legacy rows. */
  author_name: string | null;
  /** Whether the (non-anonymous) author is a hub admin. Always false for anonymous. */
  author_is_admin?: boolean;
  /**
   * The (non-anonymous) author's public office. Both null for residents
   * and — always — for anonymous comments: an office identifies a person
   * as surely as a name does, so anonymity is never pierced by it.
   */
  author_official_type?: string | null;
  author_official_title?: string | null;
  is_anonymous: boolean;
  body: string;
  submitted_at: string;
  phase: CommentPhase | null;
  moderation: CommentModerationView | null;
}

/**
 * Hub-wide identity policy for comments (admin-configurable):
 *   real_name          — no anonymity toggle; comments carry the name
 *   anonymous_optional — toggle shown, real name is the default
 *   anonymous_only     — every comment is anonymous
 */
export type CommentIdentityMode =
  | "real_name"
  | "anonymous_optional"
  | "anonymous_only";

export function getCommentIdentityMode(): Promise<{ mode: CommentIdentityMode }> {
  return request("GET", "/process/input/identity-mode");
}

export interface CommentModerationView {
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  reason: string | null;
  restored_at: string | null;
}

export function getInputs(processId: string): Promise<CommunityInput[]> {
  return request("GET", `/process/${processId}/input`);
}

export async function submitInput(
  processId: string,
  body: string,
  isAnonymous = false,
  /** "update" — a creator's update; the server allows it only for the creator. */
  phase?: "update",
): Promise<CommunityInput> {
  // A comment is taking part (a creator's update is not): the one-time card first.
  if (!phase) await askAboutYouFirst();
  // The author is the authenticated session user — the server ignores
  // any caller-supplied identity.
  return request("POST", `/process/${processId}/input`, {
    ...(phase ? { phase } : {}),
    body,
    is_anonymous: isAnonymous,
  });
}

// --- Vote Log & Receipts ---

// --- Civic Events (feed layer) ---
//
// Mirrors civic-hub/src/models/event.ts. Events are the primary public
// interface of the hub; the feed consumes them directly. Keep this shape
// in sync with the backend Civic Event Spec v0.1 model.

export interface CivicEventSource {
  hub_id: string;
  hub_url: string;
}

export interface CivicEventMeta {
  visibility: "public" | "restricted";
}

export interface CivicEvent {
  id: string;
  version: string;
  event_type: string;
  timestamp: string;
  process_id: string;
  actor: string;
  jurisdiction: string;
  action_url: string;
  source: CivicEventSource;
  dedupe_key?: string;
  data: Record<string, unknown>;
  meta: CivicEventMeta;
  /** Seeded sample content (Phase 7): set true by /api/feed when the
   *  event's process is a planted sample row. */
  sample?: boolean;
}

/** Server-batched card metadata, keyed by process_id — camelCase on
 *  purpose: it exists solely to seed Feed.tsx's ProcessMeta cache. */
export interface FeedProcessMeta {
  title?: string;
  description?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  totalVotes?: number;
  commentsCount?: number;
  editCount?: number;
  lastEditedAt?: string | null;
  blockCount?: number;
  maxStartSeconds?: number | null;
  removed?: boolean;
}

interface EventsResponse {
  events: CivicEvent[];
  count: number;
  process_meta?: Record<string, FeedProcessMeta>;
  next_cursor?: string | null;
}

/**
 * One page of GET /events, the hub's public stream (AS2), as this reader is
 * served it: the member view when signed in, the admin view for an admin.
 */
export function getEventsPage(cursor: string | null, limit = 100): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ page: "true", limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request("GET", `/events?${params}`);
}

/** What GET /api/feed/meta says of one process (services/feedPage.ts feedProcessFacts). */
export type FeedProcessFacts = { hidden: true } | { type: string; sample?: true; meta?: FeedProcessMeta };

/** The hub's facts and card metadata for processes the feed read off /events (at most 100). */
export async function getFeedMeta(processIds: string[]): Promise<Record<string, FeedProcessFacts>> {
  const params = new URLSearchParams({ process: processIds.join(",") });
  return (await request<{ processes: Record<string, FeedProcessFacts> }>("GET", `/feed/meta?${params}`)).processes;
}

/**
 * One of the feed's filter pills: a surface a type's card rules name, or the
 * kernel's "activity" (FEED_SURFACES in src/shared/feedActivity.ts).
 */
export type FeedSurface = string;

/** Cards per page of the feed. */
export const FEED_PAGE_SIZE = 25;

/**
 * One page of the feed, newest first: only the events that become cards
 * (optionally of one surface), with their card metadata batched in, and the
 * cursor for the next (older) page, or null when there is none. Paged on the
 * server since 2026-10-07; it used to send the whole log (up to 1,000 events)
 * on every page load.
 *
 * Reads /api/feed, the hub's INTERNAL read model, not /events. As of the
 * Civic Activity Spec v0.2 wire conversion, /events serves an AS2
 * OrderedCollection for external consumers; the app keeps consuming the
 * internal CivicEvent shape (and the shared feed classifier with it), so the
 * presentation layer is not coupled to the federation format.
 */
export async function getFeed(options: {
  cursor?: string | null;
  surface?: FeedSurface;
  limit?: number;
} = {}): Promise<{
  events: CivicEvent[];
  processMeta: Record<string, FeedProcessMeta>;
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({ limit: String(options.limit ?? FEED_PAGE_SIZE) });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.surface) params.set("surface", options.surface);
  const res = await request<EventsResponse>("GET", `/feed?${params}`);
  return {
    events: res.events,
    processMeta: res.process_meta ?? {},
    nextCursor: res.next_cursor ?? null,
  };
}

// --- A published brief, as the hub's BriefPointer reads it (step 3 makes the
// pointer Briefs' contribution; Briefs' pages have their own client,
// packages/civic.brief/ui/api.ts) ---

export interface BriefSection {
  heading: string;
  body: string;
}

export interface PublicBrief {
  id: string;
  type: "civic.brief";
  title: string;
  source_process_id: string;
  source_process_type: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  participation_label: string | null;
  participation_count: number | null;
  comments: string[];
  admin_notes: string;
  image_url?: string | null;
  image_alt?: string | null;
  /** The source closed before its deadline: the line and the admin's note. */
  closed_early?: { line: string; note: string } | null;
  /** A regenerated version replaced the published one on this date. */
  revised_at?: string | null;
  delivered_recipient_count: number;
  /** Public-safe recipient labels ("Jane Doe, Board of Supervisors") and
   *  the actual send time — the "Sent to … on …" receipt. Empty/null on
   *  legacy deliveries, which render the governing-body wording. */
  sent_to: string[];
  delivered_at: string | null;
  /** Addressed to these (public labels), but the hub held the email back
   *  (a demo or beta hub, sample content): `not_sent_because` says why.
   *  Absent on briefs read from an older server. */
  addressed_to?: string[];
  not_sent_because?: string | null;
  approved_at: string | null;
  generated_at: string;
  published_at: string;
  /**
   * Official responses — the government's side of the record, appended
   * to the sealed brief. "awaiting" until the first response;
   * responded_at is the FIRST response's timestamp (the date the status
   * line renders) and never moves as follow-ups arrive.
   */
  response_status: "awaiting" | "responded";
  responded_at: string | null;
  responses: PublicBriefResponse[];
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/** One official response on a brief, oldest first. The office fields are
 *  a snapshot taken at response time (a later demotion or retitle does
 *  not rewrite the record). */
export interface PublicBriefResponse {
  id: string;
  body: string;
  official_type: string;
  official_title: string;
  responder_name: string;
  created_at: string;
}

export function getPublicBrief(id: string): Promise<PublicBrief> {
  return request("GET", `/brief/${id}`);
}

// --- Admin: archive / restore (generic soft-remove) ---

export interface ArchivedProcess {
  id: string;
  type: string;
  title: string;
  archived_at: string;
  archived_by: string | null;
  reason: string | null;
  previous_status: string | null;
  type_label: string;
}

export function adminListArchived(): Promise<{
  items: ArchivedProcess[];
  count: number;
}> {
  return request("GET", "/admin/archived");
}

export function adminArchiveProcess(
  id: string,
  reason: string,
): Promise<{ message: string; id: string; status: string }> {
  return request("POST", `/admin/processes/${id}/archive`, { reason });
}

export function adminRestoreProcess(
  id: string,
): Promise<{ message: string; id: string; status: string }> {
  return request("POST", `/admin/processes/${id}/restore`);
}

// --- The officials roster and the space's result recipients (Officials settings) ---

/** The officials an admin lists, and who a result goes to when a review picks nobody. Admins only. */
export async function getOfficialsRoster(): Promise<{ officials: Official[]; brief_recipient_emails: string[] }> {
  const settings = await adminGetSettings();
  return { officials: settings.officials, brief_recipient_emails: settings.brief_recipient_emails };
}

// --- Admin: hub settings ---

export interface AnnouncementAuthor {
  email: string;
  /** Admin-curated display name; falls back to the poster's account name when blank. */
  name?: string;
  label: string;
}

export interface WaitlistEntry {
  email: string;
  created_at: string;
  /** Optional — the form never requires it. */
  name: string | null;
  notes: string | null;
  /** Opted in to "I'd like to be a test user" on the waitlist form. */
  wants_test_user: boolean;
  /** The member whose invite put this address here; null when the person asked (members and invites slice). */
  invited_by_name?: string | null;
}

/**
 * An account an admin has designated as holding a public office.
 * Designating someone an official also grants announcement posting —
 * identity and that capability are fused for now, and can be split later
 * without changing this shape.
 */
export interface Official {
  /** The admin's input key. The hub has no user directory to pick from. */
  email: string;
  /** Admin-curated display name; blank means "use their account name". */
  name?: string | null;
  /** One of OFFICIAL_TYPES — drives the pill colour, not the pill text. */
  official_type: string;
  /** What actually renders in the pill, e.g. "Board of Supervisors". */
  official_title: string;
}

export interface AdminSettings {
  // The hub's name, tagline, label, operator, contact address and "who runs
  // this site" moved to adminGetHubSettings / adminPutHubSettings.
  /** demo | beta | live. Changed through adminSetHubMode, not this endpoint. */
  readonly mode: string;

  brief_recipient_emails: string[];
  officials: Official[];
  /** @deprecated superseded by `officials`; returned read-only. */
  announcement_authors: AnnouncementAuthor[];
  beta_allowlist: string[];
  waitlist: WaitlistEntry[];
  support_threshold: number;
  comment_identity_mode: CommentIdentityMode;
}

export function adminGetSettings(): Promise<AdminSettings> {
  return request("GET", "/admin/settings");
}

export function adminPatchSettings(
  patch: Partial<AdminSettings>,
): Promise<AdminSettings> {
  return request("PATCH", "/admin/settings", patch);
}

/**
 * Live items per plugin on this hub (status proposed / threshold_met /
 * active), for the Plugins page's switch-off warning. Plugins with none are
 * absent. Shape: src/controllers/hubSettingsController.ts.
 */
export function adminGetPluginLiveCounts(): Promise<{ counts: Record<string, number> }> {
  return request("GET", "/admin/hub/plugins/live");
}

/**
 * A plugin a package provides, as the Plugins page installs and removes it
 * (src/services/pluginInstall.ts; ADR-014).
 */
export interface PluginInstall {
  plugin: string;
  name: string;
  state: "installed" | "winding_down" | "removed" | "unavailable";
  packages: Array<{
    package: string;
    version: string;
    display_name: string;
    type: string;
    grant: { can: string[]; cannot: string[] };
    approved_at: string | null;
    checked_at: string | null;
    /** This deployment runs a newer version than the hub approved: what Update changes. */
    update: { version: string; adds: string[]; drops: string[] } | null;
    /** The last update, made by Civic.Social because the version is required. */
    required_update: { from: string; to: string; at: string } | null;
  }>;
  open: number;
  wind_down_offered: boolean;
  installed_at: string | null;
  installed_by: string | null;
  removed_at: string | null;
  winding_down_since: string | null;
  update_available: boolean;
}

export function adminListPluginInstalls(): Promise<{ plugins: PluginInstall[] }> {
  return request("GET", "/admin/hub/plugins/installs");
}

export function adminInstallPlugin(plugin: string): Promise<{ plugin: PluginInstall }> {
  return request("POST", `/admin/hub/plugins/${encodeURIComponent(plugin)}/install`, {});
}

export function adminRemovePlugin(plugin: string, mode: "stop" | "wind_down"): Promise<{ plugin: PluginInstall }> {
  return request("POST", `/admin/hub/plugins/${encodeURIComponent(plugin)}/remove`, { mode });
}

export function adminUpdatePlugin(plugin: string): Promise<{ plugin: PluginInstall }> {
  return request("POST", `/admin/hub/plugins/${encodeURIComponent(plugin)}/update`, {});
}

/** One recorded run of a scheduled job. Shape: src/services/jobRuns.ts. */
export interface JobRunRecord {
  job_id: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "flagged" | "failed";
  summary: string;
  problems: string[];
}

export interface JobRunsEntry {
  job_id: string;
  job_name: string;
  /** The plugin that owns the job; null for the hub's own jobs (closing at deadlines). */
  plugin: string | null;
  last: JobRunRecord | null;
  /** The newest failed or flagged run, when it is not the last run. */
  last_problem: JobRunRecord | null;
}

/** Each scheduled job's last run on this hub, for the Plugins page. */
export function adminGetJobRuns(): Promise<{ jobs: JobRunsEntry[] }> {
  return request("GET", "/admin/hub/jobs/runs");
}

/**
 * The Settings page's Identity, Copy & pages, Legal and Email sections.
 * Shape: src/controllers/hubSettingsController.ts → HubSettingsResponse.
 */
export interface HubSettings {
  hub: {
    id: string;
    registry_name: string;
    hostname: string;
    jurisdiction_name: string | null;
    mode: string;
    /** Whether the platform has approved the hub for live (2026-11-19). Absent from an older server: not approved. */
    live_approved?: boolean;
    /** The zone the hub's place suggests, "" when none: what applies while identity.timezone is empty. */
    place_time_zone?: string;
  };
  /** The hub's own value per key; "" where it has none. */
  values: Record<string, string>;
  /** What applies when it has none, where the deployment sets one. */
  fallbacks: Record<string, string>;
  changed: Record<string, { at: string; by: string | null }>;
  platform: {
    from_address: string;
    /** What a digest footer prints and where it comes from; source null = none. */
    postal_address: { value: string; source: "hub" | "environment" | "platform" | null };
  };
  /** Document keys with a shared default to restore. */
  restorable: string[];
  /** While the hub is a demo, the platform's console may also set what residents see. */
  document_values: Record<string, string>;
  governing_law: {
    state: string;
    source: "place" | "setting" | "location" | "platform_default";
    fallback: string;
    fallback_source: "location" | "platform_default";
  } | null;
  console_may_edit: boolean;
  /** After a save: what else it changed (a rename's followers), in words. */
  follow_on?: string;
}

export function adminGetHubSettings(): Promise<HubSettings> {
  return request("GET", "/admin/hub/settings");
}

/** Save one section. Values for keys outside it are refused by the server. */
export function adminPutHubSettings(
  section: string,
  values: Record<string, string | boolean | number>,
): Promise<HubSettings> {
  return request("PUT", "/admin/hub/settings", { section, values });
}

/** A document's shared default, placeholders unfilled. */
export function adminGetSettingTemplate(
  key: string,
): Promise<{ key: string; template: string }> {
  return request("GET", `/admin/hub/settings/template/${encodeURIComponent(key)}`);
}

/** Upload a banner or logo under this hub's storage prefix. Admin only. */
export function uploadHubImage(
  kind: "banner" | "logo",
  file: Blob,
): Promise<UploadedImage> {
  return upload(`/upload/hub-image?kind=${kind}`, file);
}

// --- Who administers the hub -------------------------------------------------
//
// Its own endpoint, not part of /admin/settings, because it takes a fresh
// emailed code. Everything on the settings page is recoverable by an admin who
// still has their account; the admin roster is what decides who that is.

export interface HubPeople {
  admin_emails: string[];
  board_emails: string[];
  /** The roster is still the deployment's CIVIC_ADMIN_EMAILS bootstrap. */
  /** After a save that added admins: who got the invite email, in words. */
  invite_message?: string | null;
}

export function adminGetHubPeople(): Promise<HubPeople> {
  return request("GET", "/admin/hub/people");
}

/** Email the signed-in admin a code. Required before adminSetHubPeople. */
export function adminRequestPeopleCode(): Promise<{ message: string }> {
  return request("POST", "/admin/hub/people/request-code", {});
}

export function adminSetHubPeople(patch: {
  admin_emails?: string[];
  board_emails?: string[];
  code: string;
}): Promise<HubPeople> {
  return request("POST", "/admin/hub/people", patch);
}

// --- The hub's lifecycle mode ------------------------------------------------
//
// Same step-up as the roster, for a related reason: mode decides who may sign
// in at all. An admin may choose beta or live; only the control plane can put
// a hub INTO demo, because demo is the one mode that turns off email
// verification — see src/models/hub.ts.

/** Email the signed-in admin a code. Required before adminSetHubMode. */
export function adminRequestModeCode(): Promise<{ message: string }> {
  return request("POST", "/admin/hub/mode/request-code", {});
}

export function adminSetHubMode(
  mode: string,
  code: string,
  opts: { removeSampleContent?: boolean; accepted?: string[]; tellWaitlist?: boolean } = {},
): Promise<{ hub_id: string; mode: string; waitlist?: { told: number; failed: number } }> {
  return request("POST", "/admin/hub/mode", {
    mode,
    code,
    ...(opts.removeSampleContent ? { remove_sample_content: true } : {}),
    ...(opts.accepted && opts.accepted.length > 0 ? { accepted: opts.accepted } : {}),
    ...(opts.tellWaitlist === false ? { tell_waitlist: false } : {}),
  });
}

/** One thing that should be in place before a switch (src/services/modeReadiness.ts). */
export interface ModeReadinessItem {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  /** Can't be accepted as it is. */
  blocking: boolean;
  accept_label?: string;
  link: string;
  link_label: string;
}

export interface ModeReadiness {
  from: string;
  to: string;
  items: ModeReadinessItem[];
  consequences: { lines: string[]; waitlist_to_tell: number };
}

/** What must be in place before switching to `to`, and what the switch will do. Never cached. */
export function adminGetModeReadiness(to: string): Promise<ModeReadiness> {
  return request("GET", `/admin/hub/mode/readiness?to=${encodeURIComponent(to)}`);
}

// --- Sample content (Phase 7) --------------------------------------------------
//
// What removing the hub's sample content would take, and the removal itself,
// which takes a fresh code like the roster and the mode. Available in every
// mode; graduating out of demo offers it too (adminSetHubMode above).

export interface SampleContentSummary {
  processes: number;
  by_type: Record<string, number>;
  /** What visitors submitted while the hub was in demo; removed with the samples. */
  added_in_demo?: number;
  users: number;
  /** Real people's input on sample processes, by kind; deleted with them. */
  real_input: Record<string, number>;
  real_input_total: number;
  /** Processes that are not sample: what the hub keeps. */
  other_processes: number;
  /** Each sample an admin can delete on its own, with its page. */
  items: SampleItem[];
  /**
   * Whether Refresh samples is offered (demo and beta hubs, 2026-11-05), and
   * "Keep sample content fresh automatically" as stored.
   */
  refresh?: { available: boolean; auto: boolean };
}

/** What Refresh samples changed, by template key (src/services/sampleRefresh.ts). */
export interface SampleRefreshReport {
  skipped?: string;
  replaced: Array<{ key: string; reason: string }>;
  added: string[];
  minutes_added: string[];
}

export interface SampleRefreshResult {
  refresh: SampleRefreshReport;
  /** Each template key's title, with this hub's names. */
  titles: Record<string, string>;
  summary: SampleContentSummary;
}

/** Refresh samples (2026-11-05): demo and beta hubs, no code, in the admin log. */
export function adminRefreshSamples(): Promise<SampleRefreshResult> {
  return request("POST", "/admin/hub/sample-content/refresh", {});
}

/** "Keep sample content fresh automatically" on or off (2026-11-05). */
export function adminSetAutoRefresh(on: boolean): Promise<{ summary: SampleContentSummary }> {
  return request("POST", "/admin/hub/sample-content/auto-refresh", { on });
}

export interface SampleItem {
  id: string;
  type: string;
  title: string;
  /** A visitor's own item while the hub was a demo. */
  added_in_demo: boolean;
  path: string;
}

/** Delete one sample and what was made from it. No code. */
export function adminDeleteSample(id: string): Promise<{ deleted: SampleItem; summary: SampleContentSummary }> {
  return request("DELETE", `/admin/hub/sample-content/${encodeURIComponent(id)}`);
}

export function adminGetSampleContent(): Promise<SampleContentSummary> {
  return request("GET", "/admin/hub/sample-content");
}

export function adminRequestSampleRemovalCode(): Promise<{ message: string }> {
  return request("POST", "/admin/hub/sample-content/request-code", {});
}

export function adminRemoveSampleContent(code: string): Promise<{ summary: SampleContentSummary }> {
  return request("POST", "/admin/hub/sample-content/remove", { code });
}

// --- User settings (Slice 5) ---

/**
 * Set the user's digest frequency. null = unsubscribe, 1-30 = days
 * between digests. Returns the new value. Requires a valid session token
 * (forwarded via the shared Bearer header in request()).
 */
export function setDigestFrequency(
  frequencyDays: number | null,
): Promise<{ digest_frequency_days: number | null }> {
  return request("PATCH", "/user/settings/digest", {
    digest_frequency_days: frequencyDays,
  });
}

/** Notices about things I take part in, on or off (design pass, decision 15). */
export function setNoticesEmail(on: boolean): Promise<{ notices_email: boolean }> {
  return request("PATCH", "/user/settings/notices", { notices_email: on });
}

/** The person's look: light, dark or the device's (design pass, decision 9). */
export function setAppearance(
  appearance: "light" | "dark" | "system",
): Promise<{ appearance: "light" | "dark" | "system" }> {
  return request("PATCH", "/user/settings/appearance", { appearance });
}

/** Save (or with "" clear) the person's Mastodon handle, for Share on Mastodon. */
export function setMastodonHandle(mastodon_handle: string): Promise<{ mastodon_handle: string | null }> {
  return request("PATCH", "/user/settings/mastodon", { mastodon_handle });
}

// --- Slice 9: image upload + link previews ---

export interface UploadedImage {
  url: string;
  width: number;
  height: number;
  mime: string;
}

/**
 * Upload a single image file to the post-images bucket. The caller is
 * responsible for client-side resize / re-encode (see uploadImage in
 * components/PostImagePicker) — this helper only sends the bytes. Auth
 * Bearer token is forwarded automatically.
 */
export function uploadPostImage(file: Blob): Promise<UploadedImage> {
  return upload("/upload/post-image", file);
}

export interface LinkPreviewData {
  url: string;
  canonical_url: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  fetched_at: string;
  error: string | null;
}

/**
 * Fetch a cached or fresh OpenGraph preview for an external URL. Always
 * resolves with a LinkPreviewData object — when `error` is set, the
 * frontend renders a plain link instead of a rich card.
 */
export function getLinkPreview(url: string): Promise<LinkPreviewData> {
  return request("GET", `/link-preview?url=${encodeURIComponent(url)}`);
}

// --- Slice 11: admin moderation ---------------------------------------

export interface ModerationLogEntry {
  event_id: string;
  timestamp: string;
  process_id: string;
  process_title: string | null;
  action: string;
  target_kind: "comment" | "announcement" | null;
  reason: string | null;
  admin: string;
}

export interface ModerationLogResponse {
  entries: ModerationLogEntry[];
  count: number;
}

/** Hide a community-input comment for a Code-of-Conduct violation. */
export function adminHideComment(
  commentId: string,
  reason: string,
): Promise<CommunityInput> {
  return request("POST", `/admin/moderation/comments/${commentId}/hide`, {
    reason,
  });
}

/** Restore a previously hidden comment. */
export function adminRestoreComment(commentId: string): Promise<CommunityInput> {
  return request(
    "POST",
    `/admin/moderation/comments/${commentId}/restore`,
  );
}

/** One row of Settings → Admin log (hub_admin_audit_log), newest first. */
export interface HubAdminLogEntry {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  before: unknown;
  after: unknown;
}

/** One step of the setup checklist (src/services/modeReadiness.ts, setupChecklist). */
export interface SetupStep {
  id: string;
  label: string;
  /** What it is for, in a sentence. */
  hint: string;
  done: boolean;
  skipped: boolean;
  can_skip: boolean;
  /** Where in the hub it is set. */
  link: string;
  /** Its help registry key, for the docs link. */
  help: string;
}

export interface SetupCard {
  dismissed: boolean;
  /** The home page card's first steps. */
  steps: SetupStep[];
  /** All of them: Hub settings → Getting started (pilot readiness 3). */
  checklist: SetupStep[];
}

export function adminGetSetupCard(): Promise<SetupCard> {
  return request("GET", "/admin/hub/setup-card");
}

export function adminPostSetupCard(action: "dismiss" | "skip_second_admin"): Promise<SetupCard> {
  return request("POST", "/admin/hub/setup-card", { action });
}

export function adminGetHubAdminLog(): Promise<{ entries: HubAdminLogEntry[] }> {
  return request("GET", "/admin/hub/admin-log");
}

/** Newest-first list of every moderation action. Admin-only. */
export function adminGetModerationLog(): Promise<ModerationLogResponse> {
  return request("GET", "/admin/moderation/log");
}


// --- Contact Civic.Social (the kernel's; feedback routing) ---
// Residents' feedback is the Feedback plugin's (features/feedback/ui/api.ts).

/** An admin's own message to Civic.Social; their address goes with it. */
export function contactCivicSocial(input: { message: string; page_path?: string | null }): Promise<{ id: string; message: string }> {
  return request("POST", "/admin/contact-civic-social", input);
}

// --- Word Cloud ---
// The welcome strip's cloud (components/WordcloudTeaser.tsx) reads the
// onboarding word cloud over HTTP. Word clouds' own client is in their package
// (packages/civic.wordcloud/ui/api.ts). Kernel step 3: the strip becomes a
// contribution Word clouds registers, and this goes.

export interface WordcloudCloudEntry {
  text: string;
  count: number;
}

export interface WordcloudPromptCloud {
  prompt_id: string;
  prompt_text: string;
  entries: WordcloudCloudEntry[];
  total_submissions: number;
}

export function getWordcloudCloud(
  id: string,
): Promise<{
  id: string;
  status: string;
  submission_count: number;
  clouds: WordcloudPromptCloud[];
}> {
  return request("GET", `/wordcloud/${id}/cloud`);
}

// --- Process reviews (collaborative admin review) ---

export type ReviewStatus =
  | "pending_review"
  | "changes_requested"
  | "approved"
  | "declined"
  | "withdrawn";

export interface ProcessReviewSummary {
  id: string;
  process_id: string;
  creator_id: string;
  creator_name: string;
  creator_email: string;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
  process_type: string | null;
  process_title: string | null;
  /** The draft this submission came from; null for older reviews. */
  draft_id?: string | null;
  /** The resident sent text the Code of Conduct check flagged: its findings. Null when not flagged. */
  coc_flags?: Array<{ field: string | null; quoted_text: string | null; message: string }> | null;
}

export interface ReviewTurn {
  id: string;
  review_id: string;
  turn_number: number;
  actor: string;
  actor_role: "creator" | "admin";
  action: string;
  note: string | null;
  process_snapshot: {
    title: string;
    description: string;
    content?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
  } | null;
  created_at: string;
}

export interface ReviewDetail {
  review: ProcessReviewSummary;
  turns: ReviewTurn[];
  process: Record<string, unknown>;
  /** Everything the creator submitted, as displayable fields (server-computed
   *  through the process registry). Absent on older servers — the
   *  SubmissionPreview component then derives the same list client-side. */
  submission?: SubmissionField[] | null;
  /** The process's public page, resolved server-side through the registry.
   *  Present once the submission is approved and there is a process to point
   *  at; absent on older servers. */
  detail_path?: string | null;
}


export function getMyReviews(): Promise<ProcessReviewSummary[]> {
  return request("GET", "/reviews/mine");
}

/** Your own submissions that need you (admins too: the account menu is personal). */
export function getReviewNotificationCount(): Promise<{ count: number }> {
  return request("GET", "/notifications/reviews/count?scope=mine");
}

export function markReviewsSeen(): Promise<{ ok: boolean }> {
  return request("POST", "/notifications/reviews/seen");
}

/** Edited processes this user supports, since they last looked. */
export interface EditNotification {
  process_id: string;
  type: string;
  title: string;
  href: string;
  edits: number;
  latest_at: string;
}

export function getEditNotifications(): Promise<{ count: number; items: EditNotification[] }> {
  return request("GET", "/notifications/edits");
}

export function markEditsSeen(): Promise<{ ok: boolean }> {
  return request("POST", "/notifications/edits/seen");
}

/** Admin panel "Edits" tab: every edited process, newest first. */
export interface AdminEditRow {
  process_id: string;
  type: string;
  type_label: string;
  title: string;
  href: string;
  status: string;
  edits: number;
  latest_at: string;
  changed_fields: string[];
  unseen: boolean;
}

export function adminListEdits(): Promise<{ items: AdminEditRow[]; unseen: number }> {
  return request("GET", "/admin/edits");
}

/** The numbers on the admin tabs and the admin's account-menu dot: what is
 *  NEW in each queue since this admin last opened that tab. Opening a tab
 *  clears its count (adminMarkQueueSeen). */
export type AdminQueue = string;

/** The kernel's own queues, and one count per package queue (`briefs`, `meeting_summaries`), by its name. */
export type AdminQueueCounts = { reviews: number; edits: number; total: number } & Partial<Record<string, number>>;

export function adminQueueCounts(): Promise<AdminQueueCounts> {
  return request("GET", "/admin/queue-counts");
}

/** Opening a tab: everything in that queue up to now has been seen. */
export function adminMarkQueueSeen(queue: AdminQueue): Promise<{ ok: boolean }> {
  return request("POST", `/admin/queues/${queue}/seen`);
}

/** Pages fire this after an action that changes a queue (approve, decline,
 *  mark seen) so the admin tabs refetch their counts without a navigation. */
export const ADMIN_QUEUES_CHANGED = "civic:admin-queues-changed";
export function notifyAdminQueuesChanged(): void {
  window.dispatchEvent(new CustomEvent(ADMIN_QUEUES_CHANGED));
}

export function getReviewDetail(reviewId: string): Promise<ReviewDetail> {
  return request("GET", `/reviews/${reviewId}`);
}

/** "Edit & resubmit": reopen the draft behind a changes-requested review.
 *  Returns where to send the creator, or nulls when the review predates
 *  draft tracking (use the inline form then). */
export function reopenReview(
  reviewId: string,
): Promise<{ draft_id: string | null; draft_path: string | null }> {
  return request("POST", `/reviews/${reviewId}/reopen`);
}

export function reviseReview(
  reviewId: string,
  input: {
    title?: string;
    description?: string;
    content?: Record<string, unknown>;
    config?: Record<string, unknown>;
    note?: string;
  },
): Promise<ProcessReviewSummary> {
  return request("POST", `/reviews/${reviewId}/revise`, input);
}

export function withdrawReview(
  reviewId: string,
): Promise<ProcessReviewSummary> {
  return request("POST", `/reviews/${reviewId}/withdraw`);
}

export function adminListReviews(
  status?: string,
): Promise<ProcessReviewSummary[]> {
  const qs = status ? `?status=${status}` : "";
  return request("GET", `/admin/reviews${qs}`);
}

export function adminGetReview(reviewId: string): Promise<ReviewDetail> {
  return request("GET", `/admin/reviews/${reviewId}`);
}

export function adminApproveReview(
  reviewId: string,
): Promise<{ review: ProcessReviewSummary; process_id: string }> {
  return request("POST", `/admin/reviews/${reviewId}/approve`);
}

export function adminRequestChanges(
  reviewId: string,
  note: string,
): Promise<ProcessReviewSummary> {
  return request("POST", `/admin/reviews/${reviewId}/request-changes`, {
    note,
  });
}

export function adminDeclineReview(
  reviewId: string,
  reason: string,
): Promise<ProcessReviewSummary> {
  return request("POST", `/admin/reviews/${reviewId}/decline`, { reason });
}

// --- Process linking -------------------------------------------------------
//
// Universal across process types: every endpoint keys on a process id, so a
// process type added later is linkable with no change here.

export type RelationType = "continues" | "references" | "implements";

export interface ProposedLink {
  to_id: string;
  relation: RelationType;
}

export interface LinkPeer {
  id: string;
  type: string;
  title: string;
  status: string;
  href: string;
}

export interface RenderedLink {
  id: string;
  relation: RelationType;
  direction: "outgoing" | "incoming";
  /** Already resolved for this side of the edge ("Continues" vs "Continued by"). */
  label: string;
  peer: LinkPeer;
  created_by: string | null;
  created_at: string;
  /** Derived from data the system already holds (the brief ⇄ source pair)
   *  rather than stored as a row. Not removable. */
  synthetic?: boolean;
  /** Belongs to another process and shown here for context (a brief showing
   *  its source's links). Not removable from here. */
  inherited?: boolean;
}

export interface ProcessLinks {
  outgoing: RenderedLink[];
  incoming: RenderedLink[];
  /** Whether the signed-in viewer may add or remove links here (the process's
   *  creator, or an admin). Decided server-side so a page can mount the panel
   *  without fetching the process's creator itself. */
  can_edit?: boolean;
  relations?: Array<{
    value: RelationType;
    forward: string;
    back: string;
    description: string;
  }>;
}

export interface LinkCandidate {
  id: string;
  type: string;
  title: string;
  status: string;
  href: string;
}

/** The spec descriptor for any process type — id, title, definition.type,
 *  status. Used to put a title on a link the picker did not pick itself
 *  (a resumed draft's). */
export function getProcessDescriptor(
  id: string,
): Promise<{ id: string; title: string; status: string; definition: { type: string } }> {
  return request("GET", `/process/${encodeURIComponent(id)}`);
}

export function getProcessLinks(processId: string): Promise<ProcessLinks> {
  return request("GET", `/process/${processId}/links`);
}

export function addProcessLink(
  processId: string,
  link: ProposedLink,
): Promise<ProcessLinks & { link_id: string }> {
  return request("POST", `/process/${processId}/links`, link);
}

export function removeProcessLink(
  processId: string,
  linkId: string,
): Promise<ProcessLinks> {
  return request("DELETE", `/process/${processId}/links/${linkId}`);
}

/**
 * Typeahead over existing processes. With no `q`, the process's own title and
 * description seed the query, which is what produces the auto-suggested
 * candidates shown before the user types.
 */
export function getLinkCandidates(params: {
  q?: string;
  seedTitle?: string;
  seedDescription?: string;
  exclude?: string[];
}): Promise<{ candidates: LinkCandidate[]; suggested: boolean }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.seedTitle) qs.set("seed_title", params.seedTitle);
  if (params.seedDescription) qs.set("seed_description", params.seedDescription);
  for (const id of params.exclude ?? []) qs.append("exclude", id);
  return request("GET", `/process/link-candidates?${qs.toString()}`);
}

// --- "Share this hub" (members and invites slice, 2026-10-14) ---

export interface InviteResult {
  outcome: "emailed" | "waitlisted";
  done: number;
  over_limit: string[];
  failed: number;
  limit: number;
}

export function sendInvites(emails: string, message: string): Promise<InviteResult> {
  return request("POST", "/members/invites", { emails, message });
}

/** An open process about to close, as GET /api/feed/closing serves it (Events 4): a "closing soon" feed card. */
export interface ClosingSoonRow {
  process_id: string;
  type: string;
  title: string;
  closes_at: string;
  /** When it entered the window: where the card sits in the feed. */
  since: string;
  url: string;
  sample?: true;
}

export async function getClosingSoon(): Promise<ClosingSoonRow[]> {
  const body = await request<{ closing: ClosingSoonRow[] }>("GET", "/feed/closing");
  return body.closing ?? [];
}

/** One event on the hub's calendar, as GET /calendar/events serves it (the Events plugin's). */
export interface CalendarEventRow {
  process_id: string;
  title: string;
  start_time: string;
  end_time: string;
  cancelled: boolean;
  time_zone: string | null;
}

/** The hub's calendar, earliest first: only while the Events plugin is on (its route). */
export async function getCalendarEvents(): Promise<CalendarEventRow[]> {
  return (await request<{ events: CalendarEventRow[] }>("GET", "/calendar/events")).events;
}

// --- Breakdowns: a finished process's totals by group (districts and demographics) ---

export interface BreakdownRow {
  key: string;
  label: string;
  /** One per column; null: fewer than 5. */
  cells: Array<number | null>;
  total: number | null;
}

export interface Breakdown {
  process_id: string;
  dimension: "district" | "age" | "race";
  kind: "results" | "participants";
  title: string;
  group_label: string;
  columns: string[];
  rows: BreakdownRow[];
  hidden_label: string;
}

/** Totals by district, age group or race; empty until the process is finished, or when the hub asks nothing. */
export function getBreakdowns(processId: string): Promise<{ breakdowns: Breakdown[] }> {
  return request("GET", `/process/${processId}/breakdowns`);
}

