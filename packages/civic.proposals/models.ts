// civic.proposals module — type definitions
//
// Proposals are raw, unstructured civic ideas submitted by users.
// They are separate from civic.vote processes, which are curated and structured.
//
// GUARDRAIL: This module MUST NOT import from civic.vote or any vote-specific code.
// Proposals live in their own data store and lifecycle.

/**
 * Proposal lifecycle states.
 *
 * Canonical (aligned with the ProcessStatus terminal vocabulary):
 *   - "submitted" — live/open on the idea board, gathering interest. Maps to
 *     the canonical processes-row status "active".
 *   - "closed"    — the deadline (closes_at) has elapsed; terminal. Maps to the
 *     canonical processes-row status "closed".
 *   - "archived"  — admin/moderation soft-delete; terminal. Maps to the
 *     canonical processes-row status "archived".
 *
 * Legacy (inert — retained only so old rows and the retired conversion era
 * still type-check; never set by current code):
 *   - "endorsed"  — never set since Slice B removed auto-promotion.
 *   - "converted" — the proposal→vote conversion was retired in Phase 1.
 */
export type ProposalStatus =
  | "submitted"
  | "closed"
  | "archived"
  | "endorsed"
  | "converted";

/** A civic proposal — a user-submitted idea for community consideration */
export interface Proposal {
  id: string;
  title: string;
  description: string;
  optional_links: string[];
  submitted_by: string; // userId or DID
  status: ProposalStatus;
  support_count: number;
  category: string | null;
  assistant_helped: boolean;
  closes_at: string | null; // ISO 8601
  created_at: string; // ISO 8601
  updated_at: string;
}

/** Support record — one per (proposal_id, user_id) */
export interface ProposalSupport {
  id: string;
  proposal_id: string;
  user_id: string;
  created_at: string;
}

/** Input for creating a new proposal */
export interface CreateProposalInput {
  /**
   * Optional fixed id. The review-approval flow passes the canonical
   * `processes` row id here so the proposal child row shares one id with its
   * process record (no forking a new id on approval). Omitted for any other
   * caller, which mints a fresh `prop_` id.
   */
  id?: string;
  title: string;
  description?: string;
  optional_links?: string[];
  submitted_by: string;
  category?: string;
  assistant_helped?: boolean;
  closes_at?: string; // ISO 8601
}

/** Configuration for the proposals module */
export interface ProposalConfig {
  /** Number of endorsements required to mark a proposal as "endorsed" */
  proposal_support_threshold: number;
}

/** Default configuration */
export const DEFAULT_PROPOSAL_CONFIG: ProposalConfig = {
  proposal_support_threshold: 5,
};
