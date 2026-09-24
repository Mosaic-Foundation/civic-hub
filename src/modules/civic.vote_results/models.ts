// civic.vote_results module — type definitions
//
// A Vote Results record is a structured summary of a completed vote
// process, intended for delivery to decision-makers (e.g. Board of
// Supervisors) and public publication. Vote results records are
// themselves civic processes — they live in the same process store as
// votes and proposals and follow the spec's lifecycle model
// (Phases 0, 4, 5, 6 per Civic Process Spec §5).
//
// Historical note: this module was originally `civic.brief` (Slice 3).
// Slice 8.5 renamed it to `civic.vote_results` so the user-facing name
// ("Vote results") and the codebase identifier finally match. The
// underlying behavior — admin-reviewed, Board-delivered, then publicly
// published — is unchanged.
//
// This module is self-contained and portable across hubs. The host hub
// provides callbacks for event emission, email delivery, and finalizing
// the linked vote. The module itself has no knowledge of Express, the
// process registry, Supabase, or nodemailer.

export type VoteResultsPublicationStatus = "pending" | "approved" | "published";

export interface VoteResultsPositionBreakdown {
  option_id: string;
  option_label: string;
  count: number;
  percentage: number;
}

/**
 * Snapshot of the original vote captured at vote-results creation time.
 * Persisted on the vote-results process so the published page can show
 * residents the question and options that were on the ballot, not just
 * the tally. The snapshot is frozen at creation time — re-reading the
 * vote later may diverge if an admin has edited the vote process.
 *
 * Optional on the type because vote-results records created before
 * Slice 8.5 don't carry it. UIs MUST defend against the missing field
 * with a "context not available" fallback rather than crashing.
 */
export interface VoteContextSnapshot {
  description: string;
  method?: string; // "yes_no_unsure" | "approval" — absent on legacy records
  options: Array<{ option_id: string; option_label: string }>;
  starts_at: string | null;
  ends_at: string | null;
  /**
   * Structured content from the original vote (Background, Key
   * considerations, etc.). Optional because records created before
   * this addition don't carry it.
   */
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
  /**
   * Community comments surfaced alongside the vote results — a single
   * flat list rather than separate concern/suggestion buckets. Slice 3.5
   * populates this from the civic.input stream; admin can edit during
   * review.
   */
  comments: string[];
  admin_notes: string;
  /**
   * Snapshot of the original vote (description, options, voting window).
   * Optional because legacy records created before Slice 8.5 don't have
   * it. Render a fallback on the public page when missing.
   */
  vote_context?: VoteContextSnapshot;
  /**
   * Optional featured image (Slice 9). Public Supabase Storage URL.
   * Set during admin review (PATCH /admin/vote-results/:id). When set,
   * image_alt MUST be a non-empty string ≤ IMAGE_ALT_MAX. Validation
   * mirrors civic.announcement.
   */
  image_url?: string | null;
  image_alt?: string | null;
}

/** Cap on image alt-text — kept in sync with civic.announcement. */
export const IMAGE_ALT_MAX = 200;
export const IMAGE_URL_MAX = 1000;

/**
 * Shape of Process.state for a civic.vote_results process.
 *
 * The process-level `status` field (draft | active | closed | finalized)
 * tracks the lifecycle state machine. The vote-results-specific
 * `publication_status` tracks the admin review sub-state:
 *
 *   pending   — auto-generated, awaiting admin review
 *   approved  — admin approved, email sent, not yet published publicly
 *   published — final: visible on public /vote-results/:id page,
 *               feed post emitted
 */
export interface VoteResultsProcessState {
  type: "civic.vote_results";
  source_process_id: string;             // the vote this summarizes
  publication_status: VoteResultsPublicationStatus;
  generated_at: string;                  // ISO 8601
  approved_at: string | null;
  published_at: string | null;
  content: VoteResultsContent;
  delivered_to: string[];                // email recipients recorded on approval
}

/**
 * Event emission callback — injected by the host hub. Matches the shape
 * used by civic.vote/models.ts EmitEventFn, extended with the optional
 * action_url_path so vote-results events can point at the public page.
 */
export interface EmitEventFn {
  (input: {
    event_type: string;
    actor: string;
    process_id: string;
    jurisdiction: string;
    data: Record<string, unknown>;
    /** Phase 3 — canonical process type, stamped into data.process.type. */
    processType?: string;
    action_url_path?: string;
  }): Promise<unknown>;
}

/**
 * Email delivery callback — injected by the host hub. Returns normally on
 * success; throws on delivery failure. The module halts the approval flow
 * if this throws.
 */
export interface SendEmailFn {
  (message: {
    to: string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

/**
 * Finalize-linked-vote callback — injected by the host hub. Called after
 * the vote-results record transitions to "published". Signals the vote
 * module to finalize the underlying vote process and emit its
 * result_published. The hub wires this to call `finalizeVote` on the
 * vote process.
 */
export interface FinalizeLinkedVoteFn {
  (voteProcessId: string, actor: string): Promise<void>;
}

export interface VoteResultsProcessContext {
  process_id: string;
  jurisdiction: string;
  emit: EmitEventFn;
}

/** Standard outcome returned by module actions. */
export interface VoteResultsActionOutcome {
  state: VoteResultsProcessState;
  result: Record<string, unknown>;
}

/**
 * Input the hub passes when creating a vote-results record from a closed
 * vote. The hub is responsible for snapshotting the vote's description,
 * options, and voting window from the vote process and passing them in
 * — the module does not read from the vote process directly.
 */
export interface CreateVoteResultsFromVoteInput {
  source_process_id: string;
  vote_title: string;
  vote_description: string;
  vote_options: Array<{ option_id: string; option_label: string }>;
  vote_method?: string; // "yes_no_unsure" | "approval" — absent on legacy calls
  vote_starts_at: string | null;
  vote_ends_at: string | null;
  tally: Record<string, number>; // option → count
  total_votes: number;
  /**
   * Community-submitted comment bodies collected via civic.input while
   * the vote was active. Seeded into content.comments so admin review
   * starts with actual resident voices, not an empty textarea.
   */
  comments?: string[];
  /**
   * Structured content from the original vote (Background, Key
   * considerations, etc.). Snapshotted into vote_context so the
   * published results page shows the full vote context.
   */
  vote_content?: {
    core_question?: string;
    sections?: Array<{ title: string; body: string | string[] }>;
    key_tradeoff?: string;
    links?: Array<{ label: string; url: string }>;
  } | null;
}

/** Partial content update used by PATCH /admin/vote-results/:id. */
export interface VoteResultsContentPatch {
  comments?: string[];
  admin_notes?: string;
  /**
   * Set to a string to attach/replace the image, null to remove,
   * undefined to leave as-is. Same semantics for image_alt. Alt-text
   * is required when image_url is non-null (validated server-side).
   */
  image_url?: string | null;
  image_alt?: string | null;
}
