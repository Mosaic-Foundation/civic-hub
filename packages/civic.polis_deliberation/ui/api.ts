// Conversations' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): its own routes under /deliberations. Moved
// here from the hub's client (ui/src/services/api.ts) in kernel step 1.

import {
  apiRequest,
  askAboutYouFirst,
  type ActionResult,
  type ClosedEarly,
  type DraftSuggestion,
  type EarlyCloseOffer,
  type ProposedLink,
} from "@civic-social/plugin-sdk/ui";

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
  /** Absent on older servers — the card omits the date rather than showing
   *  "Invalid Date". */
  created_at?: string;
  /** Participation window end; null until the conversation is started. */
  deadline?: string | null;
  participant_count?: number;
  summary_status: string;
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

export interface DeliberationReadModel {
  /** Closed before its deadline: the line and the admin's note. */
  closed_early?: ClosedEarly | null;
  /** An admin could close it early now, by this action. */
  early_close?: EarlyCloseOffer | null;
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
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
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
  /**
   * Why there is no written summary: the AI failed, this hub has not allowed
   * briefs to use it, or nothing has written the result up (its own figures).
   */
  narrative?: "failed" | "not_allowed" | "unwritten";
}

export function listDeliberations(): Promise<DeliberationSummary[]> {
  return apiRequest("GET", "/deliberations");
}

/** Per-actor fields come from the session token, never from a query param. */
export function getDeliberation(processId: string): Promise<DeliberationReadModel> {
  return apiRequest("GET", `/deliberations/${processId}`);
}

export function getDeliberationClusters(processId: string): Promise<ClusterState> {
  return apiRequest("GET", `/deliberations/${processId}/clusters`);
}

export async function deliberationVote(
  processId: string,
  statementId: number,
  vote: VoteDirection,
): Promise<{ ok: boolean }> {
  await askAboutYouFirst();
  return apiRequest("POST", `/deliberations/${processId}/participate/vote`, {
    statement_id: statementId,
    vote,
  });
}

export async function deliberationSubmitStatement(
  processId: string,
  text: string,
): Promise<{ statement_id: number }> {
  await askAboutYouFirst();
  return apiRequest("POST", `/deliberations/${processId}/participate/statement`, {
    text,
  });
}

export function deliberationGetNext(
  processId: string,
): Promise<{ statement: StatementRecord | null }> {
  return apiRequest("GET", `/deliberations/${processId}/participate/next`);
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

export function startDeliberation(processId: string): Promise<ActionResult<DeliberationReadModel>> {
  return apiRequest("POST", `/deliberations/${processId}/start`);
}

