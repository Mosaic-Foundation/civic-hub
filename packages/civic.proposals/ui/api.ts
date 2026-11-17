// Proposals' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): its own routes under /proposals.

import {
  apiRequest,
  askAboutYouFirst,
  type ClosedEarly,
  type DraftCategory,
  type DraftSuggestion,
  type EarlyCloseOffer,
  type ProposedLink,
} from "@civic-social/plugin-sdk/ui";


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
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/** Proposal detail (from GET /proposals/:id) */
export interface CivicProposalDetail {
  id: string;
  /** Closed before its deadline: the line and the admin's note. */
  closed_early?: ClosedEarly | null;
  /** An admin could close it early now, by this action. */
  early_close?: EarlyCloseOffer | null;
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
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/** List proposals (optional status filter) */
export function listCivicProposals(status?: CivicProposalStatus): Promise<CivicProposalSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest("GET", `/proposals${params}`);
}

/** Get proposal detail */
/** Per-actor fields come from the session token, never from a query param. */
export function getCivicProposal(id: string): Promise<CivicProposalDetail> {
  return apiRequest("GET", `/proposals/${id}`);
}

/** Support/endorse a proposal */
export async function supportCivicProposal(
  proposalId: string,
  userId: string
): Promise<{ support_count: number; status: string; view: CivicProposalDetail | null }> {
  await askAboutYouFirst();
  return apiRequest("POST", `/proposals/${proposalId}/support`, { user_id: userId });
}

/** Withdraw support from a proposal — allowed while it is still open. */
export function unsupportCivicProposal(
  proposalId: string,
): Promise<{ support_count: number; status: string; view: CivicProposalDetail | null }> {
  return apiRequest("DELETE", `/proposals/${proposalId}/support`);
}

/** A proposal draft, as the drafting form edits it. */
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
