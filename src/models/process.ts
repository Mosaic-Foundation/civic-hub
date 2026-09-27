// Civic Process model based on Civic Process Spec v0.1
// A process represents a structured civic action (e.g., a vote, proposal, discussion)

export type ProcessStatus =
  | "draft"
  | "proposed"
  | "threshold_met"
  | "active"
  | "closed"
  | "finalized"
  | "pending_review"
  | "archived";

export interface ProcessDefinition {
  type: string; // e.g., "civic.vote"
  version: string;
}

/** Structured content section for rich issue pages */
export interface ContentSection {
  title: string;
  body: string | string[]; // string for prose, string[] for bullet points
}

/** External reference link */
export interface ContentLink {
  label: string;
  url: string;
}

/** Community input configuration */
export interface CommunityInputConfig {
  prompt: string;
  label: string;
}

/** After-vote information block */
export interface AfterVoteInfo {
  body: string;
  recipients: string[];
}

/**
 * Structured content for rich issue pages.
 * Stored alongside the process, separate from process-specific state.
 * Optional — processes without content render the plain description only.
 */
export interface ProcessContent {
  core_question?: string;
  sections?: ContentSection[];
  key_tradeoff?: string;
  links?: ContentLink[];
  community_input?: CommunityInputConfig;
  after_vote?: AfterVoteInfo;
}

export interface Process {
  id: string;
  definition: ProcessDefinition;
  title: string;
  description: string;
  status: ProcessStatus;
  /**
   * The hub (hubs.id) this process belongs to — the tenant. Not the protocol
   * identity on its events; that is the hub's protocol_hub_id.
   */
  hubId: string;
  jurisdiction: string;
  createdBy: string; // userId or DID
  createdAt: string; // ISO 8601
  updatedAt: string;
  state: Record<string, unknown>; // process-specific state
  content?: ProcessContent; // structured issue content (optional)
  /**
   * Seeded sample content (Phase 7, `processes.is_sample`): shown with a
   * Sample badge, never on the public wire, removable in one action. Set by
   * the sample seed, or inherited in the database by a process spawned from
   * a sample one.
   */
  isSample?: boolean;
}

export interface CreateProcessInput {
  id?: string; // Optional fixed ID (used by seed data for deterministic IDs)
  definition: ProcessDefinition;
  title: string;
  description: string;
  jurisdiction?: string;
  createdBy: string;
  state?: Record<string, unknown>;
  content?: ProcessContent;
  /**
   * Slice 13 — explicit ISO 8601 timestamp override for the auto-emitted
   * `civic.process.created` event. Sync paths (e.g. floyd-news-sync)
   * pass the underlying content's real-world publication time so the
   * feed displays synced items in their natural chronological position
   * rather than clustering at ingest time. The processes table's
   * `created_at` column is still set by the database default.
   */
  eventTimestamp?: string;
  /** Sample content (Phase 7). Only the sample seed sets it. */
  isSample?: boolean;
}

export interface ProcessAction {
  type: string; // e.g., "process.vote", "process.close"
  actor: string; // userId or DID
  payload: Record<string, unknown>;
  /**
   * When the action took effect, if not now — the deadline, for a close run
   * after a vote's voting_closes_at has passed (hourly or on read). Stamps
   * the events the action emits. Set only by system dispatchers
   * (closeIfExpired); request handlers build actions field by field and
   * never copy it from a body.
   */
  at?: string;
}
