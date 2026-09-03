/**
 * API service — thin fetch wrapper for the Civic Hub backend.
 * All display data comes from read-layer endpoints.
 * Actions go through the internal process action endpoint.
 */

const API_BASE = import.meta.env.DEV ? "http://localhost:3000" : "/api";

/**
 * Token storage — shared with services/auth.ts. Must stay in sync with the
 * TOKEN_KEY defined there. The backend now enforces Bearer tokens on all
 * action endpoints (POST /process/:id/action, /proposals, /proposals/:id/support,
 * /process/:id/input, /admin/*). Without this header, those endpoints return
 * 401 and the UI shows "Authentication required".
 */
const TOKEN_KEY = "civic_auth_token";

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // localStorage can throw in some privacy modes — fail safe.
    return null;
  }
}

// --- Short-lived GET cache (perf pass, 2026-08-28) --------------------------
//
// Tab-switching refetched everything from scratch (auth/me + the full
// list for the page), so every navigation cost 2-4 API roundtrips before
// anything rendered. This caches ONLY the allowlisted list/identity GETs
// below, in memory, for 30 seconds — long enough to make tab hops
// instant, short enough that a colleague's new post appears on the next
// natural refresh.
//
// Correctness guards, in order of importance:
//   - ANY non-GET request clears the whole cache, so your own mutation
//     is never hidden behind a stale list (post a proposal → the list
//     refetches fresh).
//   - The allowlist holds only list/identity endpoints. Per-actor detail
//     reads (/process/:id/state carries your_current_vote etc.) are
//     deliberately NOT cacheable.
//   - Keyed by path + auth token, so sign-in/out never serves the other
//     identity's payload.
//   - In-memory module state: a hard reload starts empty.
const CACHE_TTL_MS = 30_000;
const CACHEABLE_PATHS = new Set([
  "/feed",
  "/process",
  "/proposals",
  "/projects",
  "/deliberations",
  "/brief",
  "/auth/me",
  "/notifications/reviews/count",
  "/notifications/edits",
]);
const getCache = new Map<string, { at: number; data: unknown }>();

function isCacheable(method: string, path: string): boolean {
  if (method !== "GET") return false;
  return CACHEABLE_PATHS.has(path.split("?")[0]!);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (method !== "GET") {
    getCache.clear();
  }
  const cacheKey = `${path}|${token ?? ""}`;
  if (isCacheable(method, path)) {
    const hit = getCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.data as T;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    if (res.status === 401) {
      // Session expired or invalid. Signal the app to drop to logged-out
      // state (AuthProvider listens) instead of leaving the user "logged in"
      // while every action fails with an opaque error.
      window.dispatchEvent(new CustomEvent("civic:auth-expired"));
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }

  const data = await res.json();
  if (isCacheable(method, path)) {
    getCache.set(cacheKey, { at: Date.now(), data });
  }
  return data;
}

// --- Structured content types ---

export interface ContentSection {
  title: string;
  body: string | string[];
}

export interface ContentLink {
  label: string;
  url: string;
}

export interface CommunityInputConfig {
  prompt?: string;
  label: string;
}

export interface AfterVoteInfo {
  body: string;
  recipients: string[];
}

export interface ProcessContent {
  core_question?: string;
  sections?: ContentSection[];
  key_tradeoff?: string;
  links?: ContentLink[];
  community_input?: CommunityInputConfig;
  after_vote?: AfterVoteInfo;
}

// --- Status types ---

export type VoteProcessStatus = "draft" | "proposed" | "threshold_met" | "active" | "closed" | "finalized";
export type ProposalProcessStatus = "open" | "closed";

// --- Read layer (UI-facing) ---

/** Shared base for all process summaries */
interface ProcessSummaryBase {
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
}

/** Vote summary (from GET /process list) */
export interface VoteSummary extends ProcessSummaryBase {
  type: "civic.vote";
  status: VoteProcessStatus;
  total_votes: number;
  support_count: number;
  support_threshold: number;
  closes_at: string | null;
}

/** Proposal summary (from GET /process list) */
export interface ProposalSummary extends ProcessSummaryBase {
  type: "civic.proposal";
  status: ProposalProcessStatus;
  support_count: number;
  support_threshold: number;
}

/** Vote-results summary as it appears in the public process list. The
 *  public listProcesses endpoint only returns vote-results records with
 *  publication_status === "published"; pending/approved records are
 *  filtered out server-side.
 *
 *  Renamed from PublishedBriefSummary in Slice 8.5. */
export interface PublishedVoteResultsSummary {
  id: string;
  type: "civic.vote_results";
  title: string;
  source_process_id: string;
  publication_status: "published";
  participation_count: number;
  generated_at: string;
  published_at: string;
  created_at: string;
}

export type ProcessSummary = VoteSummary | ProposalSummary | PublishedVoteResultsSummary;

/** Vote detail state */
export interface VoteState {
  id: string;
  type: "civic.vote";
  method: string; // "yes_no_unsure" | "approval"
  title: string;
  description: string;
  status: VoteProcessStatus;
  options: string[];
  tally: Record<string, number> | null;
  total_votes: number | null;
  has_voted: boolean | null;
  your_current_vote: string | string[] | null;
  has_supported: boolean | null;
  support_count: number;
  support_threshold: number;
  activation_mode: "direct" | "proposal_required";
  voting_opens_at: string | null;
  voting_closes_at: string | null;
  closes_at: string | null;
  result: { tally: Record<string, number>; total_votes: number; computed_at: string } | null;
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
  jurisdiction?: string;
  content?: ProcessContent;
}

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
}

export type ProcessState = VoteState | ProposalState;

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
  // it) — the server resolves per-actor fields (has_voted,
  // your_current_vote) from the session, never from a query param.
  return request("GET", `/process/${id}/state`);
}

// --- Actions (internal control surface) ---

export interface ActionResult {
  process: unknown;
  result: Record<string, unknown>;
}

export function submitVote(processId: string, actor: string, option: string): Promise<ActionResult> {
  return request("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor,
    payload: { option },
  });
}

export function submitApprovalVote(processId: string, actor: string, selections: string[]): Promise<ActionResult> {
  return request("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor,
    payload: { selections },
  });
}

export function endorseProposal(processId: string, actor: string): Promise<ActionResult> {
  return request("POST", `/process/${processId}/action`, {
    type: "proposal.support",
    actor,
    payload: {},
  });
}

export function supportVote(processId: string, actor: string): Promise<ActionResult> {
  return request("POST", `/process/${processId}/action`, {
    type: "process.support",
    actor,
    payload: {},
  });
}

export function unsupportVote(processId: string, actor: string): Promise<ActionResult> {
  return request("POST", `/process/${processId}/action`, {
    type: "process.unsupport",
    actor,
    payload: {},
  });
}

// --- Civic Proposals (separate from civic.vote process) ---

export type CivicProposalStatus =
  | "submitted"
  | "endorsed"
  | "converted"
  | "archived"
  // Phase 2 added the canonical terminal "closed" status (deadline-close) to
  // the backend ProposalStatus and ProposalDetail.tsx renders it; mirror it
  // here so the `status === "closed"` comparisons type-check.
  | "closed";

/** Proposal summary (from GET /proposals list) */
export interface CivicProposalSummary {
  id: string;
  title: string;
  description: string;
  // Raw id is redacted ("") on public responses; use creator_name.
  submitted_by: string;
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
  status: CivicProposalStatus;
  support_count: number;
  support_threshold: number;
  category: string | null;
  assistant_helped: boolean;
  closes_at: string | null;
  created_at: string;
}

/** Proposal detail (from GET /proposals/:id) */
export interface CivicProposalDetail {
  id: string;
  title: string;
  description: string;
  optional_links: string[];
  submitted_by: string;
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
  status: CivicProposalStatus;
  support_count: number;
  support_threshold: number;
  has_supported: boolean | null;
  category: string | null;
  assistant_helped: boolean;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Submit a new proposal */
export function submitProposal(
  title: string,
  submittedBy: string,
  description?: string,
  optionalLinks?: string[]
): Promise<CivicProposalDetail> {
  return request("POST", "/proposals", {
    title,
    submitted_by: submittedBy,
    description,
    optional_links: optionalLinks,
  });
}

/** List proposals (optional status filter) */
export function listCivicProposals(status?: CivicProposalStatus): Promise<CivicProposalSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return request("GET", `/proposals${params}`);
}

/** Get proposal detail */
/** Per-actor fields come from the session token, never from a query param. */
export function getCivicProposal(id: string): Promise<CivicProposalDetail> {
  return request("GET", `/proposals/${id}`);
}

/** Support/endorse a proposal */
export function supportCivicProposal(
  proposalId: string,
  userId: string
): Promise<{ support_count: number; status: string }> {
  return request("POST", `/proposals/${proposalId}/support`, { user_id: userId });
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
  field: "title" | "description" | "sources" | "considerations" | "seed_statements" | null;
  message: string;
  suggested_revision: string | null;
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

/** The always-on automated Code of Conduct check for a draft of any type. */
export function reviewDraftCoC<D>(
  processType: string,
  draftId: string,
): Promise<{ response: AssistantResponse; draft: D; review_unavailable?: boolean }> {
  return request("POST", `/assistant/${processType}/drafts/${draftId}/review`);
}

// --- Proposal Drafts ---

export interface ProposalDraft {
  id: string;
  user_id: string;
  category: DraftCategory | null;
  title: string;
  description: string;
  sources: string;
  considerations: string;
  proposal_duration_ms: number;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
  draft_modified_since_review: boolean;
  steward_approved: boolean | null;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

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

export function createDraft(category?: DraftCategory): Promise<ProposalDraft> {
  return request("POST", "/proposals/drafts", { category });
}

export function listDrafts(): Promise<ProposalDraft[]> {
  return request("GET", "/proposals/drafts");
}

export function getDraft(id: string): Promise<ProposalDraft> {
  return request("GET", `/proposals/drafts/${id}`);
}

export function updateDraft(
  id: string,
  patch: Partial<Pick<ProposalDraft, "title" | "description" | "sources" | "considerations" | "category" | "proposal_duration_ms" | "links">> & { skip_modified_flag?: boolean; assistant_applied?: boolean },
): Promise<ProposalDraft> {
  return request("PATCH", `/proposals/drafts/${id}`, patch);
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
}

export function submitDraft(
  draftId: string,
  opts?: SubmitDraftOptions,
): Promise<CreateProcessResult> {
  return request("POST", `/proposals/drafts/${draftId}/submit`, opts ?? {});
}

/** Passing `review_id` turns a submit into a revision of that review (after
 *  an admin requested changes): the process is updated in place and goes
 *  back into the queue instead of a second process being created. */
export interface SubmitDraftOptions {
  review_id?: string;
  /** Edit of a LIVE process (from "Edit project"): apply in place, record, notify. */
  edit_process_id?: string;
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

export interface VoteDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  voting_duration_ms: number;
  method: string; // "yes_no_unsure" | "approval"
  custom_options: string[] | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

export function createVoteDraft(): Promise<VoteDraft> {
  return request("POST", "/votes/drafts");
}

export function getVoteDraft(id: string): Promise<VoteDraft> {
  return request("GET", `/votes/drafts/${id}`);
}

export function updateVoteDraft(
  id: string,
  patch: Partial<Pick<VoteDraft, "title" | "description" | "sources" | "voting_duration_ms" | "method" | "custom_options" | "links">> & { skip_modified_flag?: boolean; assistant_applied?: boolean },
): Promise<VoteDraft> {
  return request("PATCH", `/votes/drafts/${id}`, patch);
}

export function submitVoteDraft(
  draftId: string,
  opts?: SubmitDraftOptions,
): Promise<CreateProcessResult> {
  return request("POST", `/votes/drafts/${draftId}/submit`, opts ?? {});
}

// --- Projects (community project pages) ---

export type ProjectStatus = "active" | "archived";
export type SentimentValue = "support" | "oppose";

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  // Redacted ("") on the public LIST; retained on the DETAIL only for the
  // owner edit-affordance check. Never render it — use creator_name.
  user_id: string;
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
  status: ProjectStatus;
  support_count: number;
  oppose_count: number;
  assistant_helped: boolean;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectUpdateEntry {
  id: string;
  project_id: string;
  content: string;
  media_urls: string[];
  created_at: string;
}

export interface ProjectComment {
  id: string;
  project_id: string;
  // Raw id is redacted ("") on public responses; use creator_name.
  user_id: string;
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
  content: string;
  created_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  sources: string[];
  updates: ProjectUpdateEntry[];
  user_sentiment: SentimentValue | null;
  comment_count: number;
  // Server-computed: is the authenticated caller the project owner? Replaces
  // the client-side user_id compare so the raw id stays off the wire.
  is_owner?: boolean;
}

export function listProjects(status?: ProjectStatus): Promise<ProjectSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return request("GET", `/projects${params}`);
}

/** Per-actor fields come from the session token, never from a query param. */
export function getProjectDetail(id: string): Promise<ProjectDetail> {
  return request("GET", `/projects/${id}`);
}

export function addProjectUpdate(
  id: string,
  content: string,
  mediaUrls: string[] = [],
): Promise<ProjectUpdateEntry> {
  return request("POST", `/projects/${id}/updates`, { content, media_urls: mediaUrls });
}

export function completeProject(
  id: string,
): Promise<{ ok: boolean; message: string }> {
  return request("POST", `/projects/${id}/complete`);
}

export function setProjectSentiment(
  id: string,
  sentiment: SentimentValue | "neutral",
): Promise<{ support_count: number; oppose_count: number; user_sentiment: SentimentValue | null }> {
  return request("POST", `/projects/${id}/sentiment`, { sentiment });
}

export function listProjectComments(id: string): Promise<ProjectComment[]> {
  return request("GET", `/projects/${id}/comments`);
}

export function addProjectComment(
  id: string,
  content: string,
): Promise<ProjectComment> {
  return request("POST", `/projects/${id}/comments`, { content });
}

// --- Project Drafts (AI-augmented project drafting) ---

export interface ProjectDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

export function createProjectDraft(): Promise<ProjectDraft> {
  return request("POST", "/projects/drafts");
}

export function getProjectDraft(id: string): Promise<ProjectDraft> {
  return request("GET", `/projects/drafts/${id}`);
}

export function updateProjectDraft(
  id: string,
  patch: Partial<Pick<ProjectDraft, "title" | "description" | "sources" | "banner_image_url" | "banner_image_alt" | "links">> & { skip_modified_flag?: boolean; assistant_applied?: boolean },
): Promise<ProjectDraft> {
  return request("PATCH", `/projects/drafts/${id}`, patch);
}

export function submitProjectDraft(
  draftId: string,
  opts?: SubmitDraftOptions,
): Promise<CreateProcessResult> {
  return request("POST", `/projects/drafts/${draftId}/submit`, opts ?? {});
}

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
  phase: "proposal" | "vote" | null;
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

export function submitInput(
  processId: string,
  body: string,
  isAnonymous = false,
): Promise<CommunityInput> {
  // The author is the authenticated session user — the server ignores
  // any caller-supplied identity.
  return request("POST", `/process/${processId}/input`, {
    body,
    is_anonymous: isAnonymous,
  });
}

// --- Vote Log & Receipts ---

export interface VoteLogEntry {
  receipt_id: string;
  choice: string;
}

export interface VoteLogResponse {
  process_id: string;
  status: string;
  available: boolean;
  message?: string;
  total_votes?: number;
  log: VoteLogEntry[];
}

export interface ReceiptVerifyResponse {
  found: boolean;
  receipt_id?: string;
  choice?: string;
  message?: string;
}

export function getVoteLog(processId: string): Promise<VoteLogResponse> {
  return request("GET", `/votes/${processId}/log`);
}

export function verifyReceipt(processId: string, receiptId: string): Promise<ReceiptVerifyResponse> {
  return request("GET", `/votes/${processId}/verify?receipt=${encodeURIComponent(receiptId)}`);
}

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
}

/**
 * Fetch the hub's event feed. Returns all events in descending timestamp
 * order. Pagination is applied client-side in the feed component until the
 * backend grows server-side pagination.
 *
 * Reads /api/feed, the hub's INTERNAL read model, not /events. As of the
 * Civic Activity Spec v0.2 wire conversion, /events serves an AS2
 * OrderedCollection for external consumers; the app keeps consuming the
 * internal CivicEvent shape (and the shared feed classifier with it), so the
 * presentation layer is not coupled to the federation format.
 */
export async function getEvents(): Promise<CivicEvent[]> {
  const res = await request<EventsResponse>("GET", "/feed");
  return res.events;
}

/**
 * The feed with its server-batched card metadata (perf pass phase 2):
 * every card's second line ships in the same response, so the Feed makes
 * no per-process follow-up requests and cards render complete on the
 * first frame.
 */
export async function getFeed(): Promise<{
  events: CivicEvent[];
  processMeta: Record<string, FeedProcessMeta>;
}> {
  const res = await request<EventsResponse>("GET", "/feed");
  return { events: res.events, processMeta: res.process_meta ?? {} };
}

// --- Vote results (renamed from "Civic Briefs" in Slice 8.5) ---

export type VoteResultsPublicationStatus = "pending" | "approved" | "published";

export interface VoteResultsPositionBreakdown {
  option_id: string;
  option_label: string;
  count: number;
  percentage: number;
}

/**
 * Snapshot of the original vote captured at vote-results creation time.
 * Optional because legacy records created before Slice 8.5 don't have
 * it. UIs MUST defend against the missing field with a "context not
 * available" fallback.
 */
export interface VoteContextSnapshot {
  description: string;
  method?: string;
  options: Array<{ option_id: string; option_label: string }>;
  starts_at: string | null;
  ends_at: string | null;
  content?: {
    core_question?: string;
    sections?: Array<{ title: string; body: string | string[] }>;
    key_tradeoff?: string;
    links?: Array<{ label: string; url: string }>;
  } | null;
}

export interface VoteResultsContent {
  title: string;
  participation_count: number;
  position_breakdown: VoteResultsPositionBreakdown[];
  comments: string[];
  admin_notes: string;
  vote_context?: VoteContextSnapshot;
  image_url?: string | null;
  image_alt?: string | null;
}

/** Admin list summary */
export interface VoteResultsSummary {
  id: string;
  type: "civic.vote_results";
  title: string;
  source_process_id: string;
  publication_status: VoteResultsPublicationStatus;
  participation_count: number;
  vote_description_preview?: string;
  generated_at: string;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
}

/** Admin detail (full record including editable content). */
export interface VoteResultsDetail extends VoteResultsSummary {
  content: VoteResultsContent;
  delivered_to: string[];
  created_by: string;
}

/** Public — returned only when publication_status === "published". */
export interface PublicVoteResults {
  id: string;
  type: "civic.vote_results";
  title: string;
  source_process_id: string;
  participation_count: number;
  position_breakdown: VoteResultsPositionBreakdown[];
  comments: string[];
  admin_notes: string;
  vote_context?: VoteContextSnapshot;
  image_url?: string | null;
  image_alt?: string | null;
  delivered_recipient_count: number;
  approved_at: string | null;
  generated_at: string;
  published_at: string;
}

export interface VoteResultsContentPatch {
  comments?: string[];
  admin_notes?: string;
  image_url?: string | null;
  image_alt?: string | null;
}

export function adminListVoteResults(
  status?: VoteResultsPublicationStatus,
): Promise<VoteResultsSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return request("GET", `/admin/vote-results${params}`);
}

export function adminGetVoteResults(id: string): Promise<VoteResultsDetail> {
  return request("GET", `/admin/vote-results/${id}`);
}

export function adminPatchVoteResults(
  id: string,
  patch: VoteResultsContentPatch,
): Promise<VoteResultsDetail> {
  return request("PATCH", `/admin/vote-results/${id}`, patch);
}

export function adminApproveVoteResults(
  id: string,
): Promise<{ message: string; vote_results: VoteResultsDetail }> {
  return request("POST", `/admin/vote-results/${id}/approve`);
}

export function getPublicVoteResults(id: string): Promise<PublicVoteResults> {
  return request("GET", `/vote-results/${id}`);
}

// --- Universal briefs (civic.brief) ---
// The generic, admin-reviewed results for any closed process. Mirrors the
// vote-results API but with type-agnostic content (headline / summary /
// sections) instead of vote-specific position breakdowns.

export type BriefPublicationStatus = "pending" | "approved" | "published";

export interface BriefSection {
  heading: string;
  body: string;
}

export interface BriefContent {
  title: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  participation_label: string | null;
  participation_count: number | null;
  comments: string[];
  admin_notes: string;
  image_url?: string | null;
  image_alt?: string | null;
}

export interface BriefSummary {
  id: string;
  type: "civic.brief";
  title: string;
  source_process_id: string;
  source_process_type: string;
  publication_status: BriefPublicationStatus;
  headline: string;
  participation_count: number | null;
  summary_preview: string;
  generated_at: string;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
}

/** One delivery recipient picked during review. The email is where the
 *  brief is sent (admin-only); the label is what the published page's
 *  "Sent to …" receipt shows. */
export interface BriefRecipient {
  email: string;
  label: string;
}

export interface BriefDetail extends BriefSummary {
  content: BriefContent;
  delivered_to: string[];
  /** Per-review selection: null = never touched (approval falls back to
   *  the hub-wide setting), [] = explicitly no delivery. */
  recipients: BriefRecipient[] | null;
  delivered_at: string | null;
  delivered_to_labels: string[];
  created_by: string;
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
  delivered_recipient_count: number;
  /** Public-safe recipient labels ("Jane Doe, Board of Supervisors") and
   *  the actual send time — the "Sent to … on …" receipt. Empty/null on
   *  legacy deliveries, which render the governing-body wording. */
  sent_to: string[];
  delivered_at: string | null;
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

export interface BriefContentPatch {
  comments?: string[];
  admin_notes?: string;
  headline?: string;
  summary?: string;
  image_url?: string | null;
  image_alt?: string | null;
  /** Per-review delivery selection; [] means "publish with no email". */
  recipients?: BriefRecipient[];
}

export function adminListBriefs(
  status?: BriefPublicationStatus,
): Promise<BriefSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return request("GET", `/admin/briefs${params}`);
}

export function adminGetBrief(id: string): Promise<BriefDetail> {
  return request("GET", `/admin/briefs/${id}`);
}

export function adminPatchBrief(
  id: string,
  patch: BriefContentPatch,
): Promise<BriefDetail> {
  return request("PATCH", `/admin/briefs/${id}`, patch);
}

export function adminApproveBrief(
  id: string,
): Promise<{ message: string; brief: BriefDetail }> {
  return request("POST", `/admin/briefs/${id}/approve`);
}

export function getPublicBrief(id: string): Promise<PublicBrief> {
  return request("GET", `/brief/${id}`);
}

/** Post a public official response (official-role accounts only; 403
 *  otherwise). Returns the refreshed response list + status. */
export function postBriefResponse(
  id: string,
  body: string,
): Promise<{
  message: string;
  response_id: string;
  response_status: "awaiting" | "responded";
  responded_at: string | null;
  responses: PublicBriefResponse[];
}> {
  return request("POST", `/brief/${id}/response`, { body });
}

// --- Announcements ---

/**
 * Free-form display label for the announcement author ("Admin", "Board
 * member", "Planning Committee", etc.). Server-side admins always get
 * "Admin"; non-admin authors get the label configured in the admin's
 * announcement_authors list. Rendered verbatim on the feed and the
 * public announcement page. Older Slice 4 announcements may carry
 * "board" — renders fine either way.
 */
export type AnnouncementAuthorRole = string;

export interface AnnouncementLink {
  label: string;
  url: string;
}

/** Full read of one announcement (GET /announcement/:id). */
export interface Announcement {
  id: string;
  type: "civic.announcement";
  title: string;
  body: string;
  links: AnnouncementLink[];
  image_url: string | null;
  image_alt: string | null;
  // Server-computed: true when the authenticated caller is the author. Drives
  // the edit affordance without exposing the raw author id. Use creator_name /
  // creator_is_admin for attribution.
  is_owner?: boolean;
  /** Resolved display name of the author (full_name ?? display_name ?? "Resident"). */
  creator_name: string;
  /** Whether the author is a hub admin. */
  creator_is_admin: boolean;
  /**
   * The author's public office, when an admin has designated one on their
   * account. Both null for residents. The TITLE renders as its own pill
   * next to the name (see Creator); the TYPE only selects its colour.
   * Independent of creator_is_admin — an account can carry both.
   */
  creator_official_type: string | null;
  creator_official_title: string | null;
  author_role: AnnouncementAuthorRole;
  /**
   * Machine-readable office behind author_role. Null for admin-authored
   * and synced posts. Present so a per-office feed pill colour can be
   * added later without backfilling old announcements.
   */
  official_type?: string | null;
  author_display_name: string | null;
  created_at: string;
  last_edited_at: string | null;
  edit_count: number;
  /**
   * Slice 11 — moderation state. Null on never-moderated announcements.
   * When `removed` is true and the viewer is not an admin, the body /
   * image / links fields above are blank and the page renders a
   * tombstone in their place. Admins keep receiving the original
   * content via the same endpoint with their token attached.
   */
  moderation?: AnnouncementModerationView | null;
}

export interface AnnouncementModerationView {
  removed: boolean;
  removed_at: string | null;
  /** Internal-audit only — admin endpoints include this; public read does not. */
  removed_by?: string | null;
  /** Internal-audit only — admin endpoints include this; public read does not. */
  reason?: string | null;
  restored_at: string | null;
}

/** Summary row (GET /announcements). */
export interface AnnouncementSummary {
  id: string;
  type: "civic.announcement";
  title: string;
  image_url: string | null;
  image_alt: string | null;
  author_role: AnnouncementAuthorRole;
  /**
   * Machine-readable office behind author_role. Null for admin-authored
   * and synced posts. Present so a per-office feed pill colour can be
   * added later without backfilling old announcements.
   */
  official_type?: string | null;
  author_display_name: string | null;
  created_at: string;
  last_edited_at: string | null;
  edit_count: number;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  links?: AnnouncementLink[];
  image_url?: string | null;
  image_alt?: string | null;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  links?: AnnouncementLink[];
  /**
   * Set to a string to attach/replace, null to remove, undefined to
   * leave unchanged. Same semantics for image_alt.
   */
  image_url?: string | null;
  image_alt?: string | null;
}

export function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<Announcement> {
  return request("POST", "/announcement", input);
}

export function updateAnnouncement(
  id: string,
  input: UpdateAnnouncementInput,
): Promise<Announcement> {
  return request("PATCH", `/announcement/${id}`, input);
}

export function getAnnouncement(id: string): Promise<Announcement> {
  return request("GET", `/announcement/${id}`);
}

export function listAnnouncements(limit?: number): Promise<AnnouncementSummary[]> {
  const q = typeof limit === "number" ? `?limit=${limit}` : "";
  return request("GET", `/announcements${q}`);
}

// --- Meeting summaries (Slice 6) ---

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
  pending_revision?: { generated_at: string } | null;
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
  return request("GET", `/admin/meeting-summaries${params}`);
}

export function adminGetMeetingSummary(
  id: string,
): Promise<MeetingSummaryDetail> {
  return request("GET", `/admin/meeting-summaries/${id}`);
}

export function adminPatchMeetingSummary(
  id: string,
  patch: MeetingSummaryPatch,
): Promise<MeetingSummaryDetail> {
  return request("PATCH", `/admin/meeting-summaries/${id}`, patch);
}

export function adminApproveMeetingSummary(
  id: string,
): Promise<{ message: string; meeting_summary: MeetingSummaryDetail }> {
  return request("POST", `/admin/meeting-summaries/${id}/approve`);
}

export function adminBatchApproveMeetingSummaries(
  ids: string[],
  opts?: { backdate?: boolean },
): Promise<{ message: string; published: number; skipped: number; failed: number }> {
  return request("POST", `/admin/meeting-summaries/batch-approve`, {
    ids,
    backdate: opts?.backdate ?? false,
  });
}

/** Accept the waiting revision — its content becomes the live summary. */
export function adminAcceptMeetingSummaryRevision(
  id: string,
): Promise<{ message: string; meeting_summary: MeetingSummaryDetail }> {
  return request("POST", `/admin/meeting-summaries/${id}/revision/accept`);
}

/** Drop the waiting revision. The published summary continues unchanged. */
export function adminDiscardMeetingSummaryRevision(
  id: string,
): Promise<{ message: string; meeting_summary: MeetingSummaryDetail }> {
  return request("POST", `/admin/meeting-summaries/${id}/revision/discard`);
}

export function adminCleanupOrphanedEvents(): Promise<{ message: string; removed: number }> {
  return request("POST", `/admin/cleanup-orphaned-events`);
}

export function adminBatchDeleteMeetingSummaries(
  ids: string[],
): Promise<{ message: string; deleted: number; archived?: number; skipped: number }> {
  // Soft-archive (restorable), not hard-delete — see the backend handler.
  return request("POST", `/admin/meeting-summaries/batch-delete`, { ids });
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

export function getMeetingSummary(id: string): Promise<PublicMeetingSummary> {
  return request("GET", `/meeting-summary/${id}`);
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
export async function uploadPostImage(file: Blob): Promise<UploadedImage> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/upload/post-image`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function uploadProjectImage(file: Blob): Promise<UploadedImage> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/upload/project-image`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Upload failed: ${res.status}`);
  }
  return res.json();
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

// --- Slice 10.5: full-text search ---

export type SearchTypeKey =
  | "vote"
  | "vote_results"
  | "announcement"
  | "meeting_summary";

export type SearchSort = "relevance" | "newest";

export interface SearchHit {
  process_id: string;
  type: string;
  title: string;
  description: string;
  created_at: string;
  status: string;
  rank: number;
  href: string;
}

export interface SearchResultPage {
  hits: SearchHit[];
  total: number;
  query: {
    q: string;
    types?: SearchTypeKey[];
    from?: string;
    to?: string;
    sort?: SearchSort;
    limit?: number;
    offset?: number;
  };
  took_ms: number;
}

export interface SearchParams {
  q: string;
  types?: SearchTypeKey[];
  from?: string;
  to?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
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

/** Remove an announcement (renders a tombstone for non-admin viewers). */
export function adminRemoveAnnouncement(
  processId: string,
  reason: string,
): Promise<Announcement> {
  return request(
    "POST",
    `/admin/moderation/announcements/${processId}/remove`,
    { reason },
  );
}

/** Restore a previously removed announcement. */
export function adminRestoreAnnouncement(
  processId: string,
): Promise<Announcement> {
  return request(
    "POST",
    `/admin/moderation/announcements/${processId}/restore`,
  );
}

/** Newest-first list of every moderation action. Admin-only. */
export function adminGetModerationLog(): Promise<ModerationLogResponse> {
  return request("GET", "/admin/moderation/log");
}

/**
 * Run a full-text search across all post types. Always resolves; an
 * empty `q` short-circuits server-side and returns total: 0 without a
 * DB hit.
 */
export function search(params: SearchParams): Promise<SearchResultPage> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.types && params.types.length > 0) {
    for (const t of params.types) sp.append("type", t);
  }
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.sort) sp.set("sort", params.sort);
  if (typeof params.limit === "number") sp.set("limit", String(params.limit));
  if (typeof params.offset === "number") sp.set("offset", String(params.offset));
  return request("GET", `/search?${sp.toString()}`);
}

// --- Deliberations (Polis integration) ---

export type VoteDirection = "agree" | "disagree" | "pass";

export interface StatementRecord {
  id: number;
  text: string;
  is_seed: boolean;
  created: string;
}

export interface OpinionGroup {
  id: number;
  size: number;
  representative_statements: {
    text: string;
    direction: "agree" | "disagree";
    repness: number;
  }[];
}

export interface ConsensusStatement {
  statement_id: number;
  text: string;
  agree_rate: number;
  vote_count: number;
}

export interface ClusterState {
  participant_count: number;
  statement_count: number;
  math_tick: number;
  groups: OpinionGroup[];
  consensus: {
    agree: ConsensusStatement[];
    disagree: ConsensusStatement[];
  };
}

export interface DeliberationSummary {
  process_id: string;
  type: string;
  title?: string;
  topic: string;
  lifecycle: string;
  participant_count?: number;
  summary_status: string;
}

export interface DeliberationReadModel {
  process_id: string;
  type: string;
  lifecycle: string;
  topic: string;
  framing: string;
  polis_conversation_id: string | null;
  deadline: string | null;
  /** Participation window; the deadline is computed from it at start. */
  duration_ms?: number | null;
  assistant_helped?: boolean;
  /** "Learn more" links shown under the framing. */
  sources?: string[] | null;
  participation_threshold: number | null;
  summary: DeliberationSummaryData | null;
  summary_status: string;
  continued_from_response_id: string | null;
  has_submitted?: boolean;
}

export interface DeliberationSummaryData {
  summary_text: string;
  directed_questions: string[];
  top_consensus_statements: {
    statement_text: string;
    agree_rate: number;
    vote_count: number;
  }[];
  opinion_groups: {
    group_id: number;
    size: number;
    representative_statements: {
      text: string;
      agreement_within_group: number;
    }[];
  }[];
  participation_stats: {
    total_participants: number;
    total_statements: number;
    total_votes: number;
    opinion_groups_formed: number;
  };
  linked_polis_data_uri: string;
  methodology: {
    prompt_version: string;
    model_used: string;
    generated_at: string;
  };
}

export function listDeliberations(): Promise<DeliberationSummary[]> {
  return request("GET", "/deliberations");
}

/** Per-actor fields come from the session token, never from a query param. */
export function getDeliberation(processId: string): Promise<DeliberationReadModel> {
  return request("GET", `/deliberations/${processId}`);
}

export function getDeliberationClusters(processId: string): Promise<ClusterState> {
  return request("GET", `/deliberations/${processId}/clusters`);
}

export function deliberationVote(
  processId: string,
  statementId: number,
  vote: VoteDirection,
): Promise<{ ok: boolean }> {
  return request("POST", `/deliberations/${processId}/participate/vote`, {
    statement_id: statementId,
    vote,
  });
}

export function deliberationSubmitStatement(
  processId: string,
  text: string,
): Promise<{ statement_id: number }> {
  return request("POST", `/deliberations/${processId}/participate/statement`, {
    text,
  });
}

export function deliberationGetNext(
  processId: string,
): Promise<{ statement: StatementRecord | null }> {
  return request("GET", `/deliberations/${processId}/participate/next`);
}

export function createDeliberation(input: {
  topic: string;
  framing: string;
  deadline?: string;
  duration_ms?: number;
  participation_threshold?: number;
  seed_statements?: string[];
}): Promise<CreateProcessResult> {
  return request("POST", "/deliberations", input);
}

// --- Deliberation Drafts (conversation drafting with assistant help) ---
// title = the conversation topic, description = the framing.

export interface DeliberationDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  seed_statements: string;
  duration_ms: number;
  participation_threshold: number | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

export function createDeliberationDraft(): Promise<DeliberationDraft> {
  return request("POST", "/deliberations/drafts");
}

export function getDeliberationDraft(id: string): Promise<DeliberationDraft> {
  return request("GET", `/deliberations/drafts/${id}`);
}

export function updateDeliberationDraft(
  id: string,
  patch: Partial<Pick<DeliberationDraft, "title" | "description" | "sources" | "seed_statements" | "duration_ms" | "participation_threshold" | "links">> & { skip_modified_flag?: boolean; assistant_applied?: boolean },
): Promise<DeliberationDraft> {
  return request("PATCH", `/deliberations/drafts/${id}`, patch);
}

export function submitDeliberationDraft(
  draftId: string,
  opts?: SubmitDraftOptions,
): Promise<CreateProcessResult> {
  return request("POST", `/deliberations/drafts/${draftId}/submit`, opts ?? {});
}

export function startDeliberation(processId: string): Promise<unknown> {
  return request("POST", `/deliberations/${processId}/start`);
}

// --- Slice 14 — feedback ---

// Mirrors FeedbackCategory in src/modules/civic.feedback/models.ts —
// keep the two in step; the server validates against its own list.
export type FeedbackCategory =
  | "idea"
  | "topic"
  | "bug"
  | "moderation"
  | "general";

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  message: string;
  name?: string | null;
  email?: string | null;
  /**
   * Honeypot — real users leave this empty. Bots fill every input. The
   * server returns 200 either way so spam can't probe the difference.
   */
  website?: string;
}

export function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<{ message: string; submission_id?: string }> {
  return request("POST", "/feedback", input);
}

/** One row of the admin feedback archive. Admin-only — carries PII. */
export interface FeedbackSubmission {
  id: string;
  created_at: string;
  category: FeedbackCategory;
  message: string;
  name: string | null;
  email: string | null;
  user_id: string | null;
  user_agent: string | null;
}

/**
 * Admin feedback archive, newest first. `category` omitted (or "all")
 * returns every category. Read-only: there is no write counterpart.
 */
export function adminListFeedback(
  category?: FeedbackCategory | "all",
): Promise<{ items: FeedbackSubmission[]; count: number }> {
  const qs =
    category && category !== "all"
      ? `?category=${encodeURIComponent(category)}`
      : "";
  return request("GET", `/admin/feedback${qs}`);
}

// --- Word Cloud ---

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

export interface WordcloudState {
  id: string;
  type: "civic.wordcloud";
  title: string;
  description: string;
  status: string;
  prompts: Array<{ id: string; text: string; max_length?: number }>;
  lifecycle_mode: "fixed" | "evergreen";
  config: {
    max_submission_length: number;
    display_threshold: number;
  };
  submission_count: number;
  clouds: WordcloudPromptCloud[];
  jurisdiction: string;
  created_at: string;
  created_by: string;
  has_submitted: boolean;
}

/**
 * The actor is resolved from the session token the request wrapper already
 * sends — never from a query param, which let any caller read another
 * resident's per-actor fields by passing their user id.
 */
export function getWordcloud(id: string): Promise<WordcloudState> {
  return request("GET", `/wordcloud/${id}`);
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

export interface WordcloudResponse {
  id: string;
  body: string;
  submitted_at: string;
  prompt_id: string;
}

export function getWordcloudResponses(
  id: string,
  promptId?: string,
): Promise<{ responses: WordcloudResponse[] }> {
  const qs = promptId ? `?prompt_id=${promptId}` : "";
  return request("GET", `/wordcloud/${id}/responses${qs}`);
}

export async function createWordcloudProcess(input: {
  title: string;
  description: string;
  promptText: string;
}): Promise<{ id: string }> {
  const promptId = `prompt-${Date.now()}`;
  const process = await request<{ id: string }>("POST", "/process", {
    definition: { type: "civic.wordcloud" },
    title: input.title,
    description: input.description,
    state: {
      prompts: [{ id: promptId, text: input.promptText }],
      lifecycle_mode: "evergreen",
    },
  });
  await request("POST", `/process/${process.id}/action`, {
    type: "process.activate",
    payload: {},
  });
  return process;
}

export function submitWordcloudResponse(
  processId: string,
  promptId: string,
  text: string,
): Promise<ActionResult> {
  return request("POST", `/process/${processId}/action`, {
    type: "process.submit",
    actor: "unused",
    payload: { prompt_id: promptId, text },
  });
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

import type { SubmissionField } from "../../../src/shared/submissionPreview";

export interface ReviewDetail {
  review: ProcessReviewSummary;
  turns: ReviewTurn[];
  process: Record<string, unknown>;
  /** Everything the creator submitted, as displayable fields (server-computed
   *  through the process registry). Absent on older servers — the
   *  SubmissionPreview component then derives the same list client-side. */
  submission?: SubmissionField[] | null;
}

export function submitForReview(input: {
  process_type: string;
  title: string;
  description: string;
  creator_name: string;
  creator_email: string;
  content?: Record<string, unknown>;
  config?: Record<string, unknown>;
  state?: Record<string, unknown>;
}): Promise<{ review: ProcessReviewSummary; process_id: string }> {
  return request("POST", "/reviews/submit", input);
}

export function getMyReviews(): Promise<ProcessReviewSummary[]> {
  return request("GET", "/reviews/mine");
}

export function getReviewNotificationCount(): Promise<{ count: number }> {
  return request("GET", "/notifications/reviews/count");
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

// --- Outcomes index --------------------------------------------------------

export interface OutcomeEntry {
  id: string;
  title: string;
  source_process_id: string;
  source_process_type: string;
  headline: string;
  participation_label: string | null;
  published_at: string;
  /** Links on the process this brief summarizes — "does this sit in a thread". */
  related_count: number;
}

export interface OutcomesPage {
  outcomes: OutcomeEntry[];
  total: number;
  total_unfiltered: number;
  filters: { source_types: string[]; years: number[] };
}

export function getOutcomes(params: {
  sourceTypes?: string[];
  year?: number | null;
  sort?: "newest" | "oldest";
} = {}): Promise<OutcomesPage> {
  const qs = new URLSearchParams();
  for (const t of params.sourceTypes ?? []) qs.append("source_type", t);
  if (params.year != null) qs.set("year", String(params.year));
  if (params.sort) qs.set("sort", params.sort);
  const q = qs.toString();
  return request("GET", `/brief${q ? `?${q}` : ""}`);
}
