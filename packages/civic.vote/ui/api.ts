// Votes' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): a vote's state and the list, casting and
// supporting (the kernel's action route), its drafts' voting windows, and the
// public log and receipt check under /votes.

import {
  apiRequest,
  askAboutYouFirst,
  type CommunityInputConfig,
  type ClosedEarly,
  type DraftSuggestion,
  type EarlyCloseOffer,
  type ProcessSummaryBase,
  type ProposedLink,
} from "@civic-social/plugin-sdk/ui";

export interface ContentSection {
  title: string;
  body: string | string[];
}

export interface ContentLink {
  label: string;
  url: string;
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

export type VoteProcessStatus = "draft" | "proposed" | "threshold_met" | "active" | "closed" | "finalized";

/** Vote summary (from GET /process list) */
export interface VoteSummary extends ProcessSummaryBase {
  type: "civic.vote";
  status: VoteProcessStatus;
  total_votes: number;
  support_count: number;
  support_threshold: number;
  closes_at: string | null;
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

/** Vote detail state */
export interface VoteState {
  id: string;
  /** How a receipt check answers once the vote closes. */
  check_mode?: "show_choice" | "counted_only";
  /** Closed before its deadline: the line and the admin's note. */
  closed_early?: ClosedEarly | null;
  /** An admin could close it early now, by this action. */
  early_close?: EarlyCloseOffer | null;
  type: "civic.vote";
  method: string; // "yes_no_unsure" | "approval"
  title: string;
  description: string;
  status: VoteProcessStatus;
  options: string[];
  tally: Record<string, number> | null;
  total_votes: number | null;
  has_voted: boolean | null;
  // No "your current vote": the hub keeps no link from a voter to a ballot.
  // The voter's own choice comes from the receipt this browser holds
  // (services/voteReceipts.ts).
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
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/** The receipt and change key a voter's browser holds, sent to change a vote. */
export interface HeldReceiptPayload {
  receipt_id: string;
  change_key: string;
}

export async function submitVote(
  processId: string,
  actor: string,
  option: string,
  receipt: HeldReceiptPayload | null = null,
): Promise<ActionResult> {
  await askAboutYouFirst();
  return apiRequest("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor,
    payload: receipt ? { option, receipt } : { option },
  });
}

export async function submitApprovalVote(
  processId: string,
  actor: string,
  selections: string[],
  receipt: HeldReceiptPayload | null = null,
): Promise<ActionResult> {
  await askAboutYouFirst();
  return apiRequest("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor,
    payload: receipt ? { selections, receipt } : { selections },
  });
}

export async function supportVote(processId: string, actor: string): Promise<ActionResult> {
  await askAboutYouFirst();
  return apiRequest("POST", `/process/${processId}/action`, {
    type: "process.support",
    actor,
    payload: {},
  });
}

export function unsupportVote(processId: string, actor: string): Promise<ActionResult> {
  return apiRequest("POST", `/process/${processId}/action`, {
    type: "process.unsupport",
    actor,
    payload: {},
  });
}

export interface VoteDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  voting_duration_ms: number;
  method: string; // "yes_no_unsure" | "approval"
  custom_options: string[] | null;
  /** Derived, client-side: custom_options as one-per-line text, so the
   *  assistant layer (chips, Apply, "has content") treats options like any
   *  other field. Set by ProposeDraftVote's withOptions(). */
  options?: string;
  /** How the receipt check answers after close (null: the hub default at submit). */
  check_mode: "show_choice" | "counted_only" | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

/** The voting windows this hub allows, in days (plugin.vote.*_duration_days). */
export interface VoteDurationLimits {
  min_days: number;
  max_days: number;
  default_days: number;
}

export function getVoteDurationLimits(): Promise<VoteDurationLimits> {
  return apiRequest("GET", "/votes/drafts/duration-limits");
}

export type CheckMode = "show_choice" | "counted_only";

export interface VoteLogEntry {
  receipt_id: string;
  /** Absent when the vote shows only that ballots were counted. */
  choice?: string;
}

export interface VoteLogResponse {
  process_id: string;
  title?: string;
  status: string;
  available: boolean;
  /** How this vote's receipt check answers (once it is available). */
  check_mode?: CheckMode;
  message?: string;
  total_votes?: number;
  log: VoteLogEntry[];
}

export interface ReceiptVerifyResponse {
  found: boolean;
  receipt_id?: string;
  /** The vote's title, for "counted in <vote>". */
  title?: string;
  check_mode?: CheckMode;
  /** Only when the vote shows the choice. */
  choice?: string;
  message?: string;
}

export function getVoteLog(processId: string): Promise<VoteLogResponse> {
  return apiRequest("GET", `/votes/${processId}/log`);
}

/** A POST: the receipt goes in the body, never in a URL a log would keep. */
export function verifyReceipt(processId: string, receiptId: string): Promise<ReceiptVerifyResponse> {
  return apiRequest("POST", `/votes/${processId}/verify`, { receipt: receiptId });
}


/** A vote's list row, or its published results (the list's other kind). */
export type ProcessSummary = VoteSummary | PublishedVoteResultsSummary;

/** A vote's state, as GET /process/:id/state reads it for this caller. */
export type ProcessState = VoteState;

/** What every process action answers: its result, and the process as this caller now reads it. */
export interface ActionResult<V = ProcessState> {
  result: Record<string, unknown>;
  view: V | null;
}

/** The votes (and their published results), from the kernel's process list. */
export function listProcesses(types: string[]): Promise<ProcessSummary[]> {
  const qs = new URLSearchParams();
  for (const t of types) qs.append("type", t);
  return apiRequest("GET", `/process?${qs.toString()}`);
}

/** A vote's state: the caller's identity rides on the session (has_voted). */
export function getProcessState(id: string): Promise<ProcessState> {
  return apiRequest("GET", `/process/${id}/state`);
}
