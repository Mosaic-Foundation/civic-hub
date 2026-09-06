// civic.input module — type definitions
//
// Community input is stored independently from votes.
// It is not used in vote tallying or lifecycle transitions.

// "comment" is a plain comment on any process that is not a vote or a
// proposal (a project, a conversation); "update" is a post by the process's
// creator — a project update — stored here so it gets the same word list,
// admin hide and audit trail as every other free-text post (2026-09-06).
export type CommentPhase = "proposal" | "vote" | "comment" | "update";

export interface CommunityInput {
  id: string;
  process_id: string;
  /**
   * Always stored for moderation accountability. Public read models
   * redact this field for non-admin callers — residents identify each
   * other by author_name, never by id.
   */
  author_id: string;
  /**
   * Snapshot of the author's real name at post time. null for
   * anonymous comments and for legacy rows that pre-date the
   * required-name policy.
   */
  author_name: string | null;
  /** Resident chose to post anonymously (display-level only). */
  is_anonymous: boolean;
  /**
   * Whether the (non-anonymous) author is a hub admin, resolved at read
   * time from author_id via the central creator resolver. Always false
   * for anonymous comments — anonymity is never pierced, even for admins.
   * Attached by the read/list controller, not persisted.
   */
  author_is_admin?: boolean;
  /**
   * The (non-anonymous) author's public office, resolved at read time
   * from author_id alongside author_is_admin. Both null for anonymous
   * comments and for residents. Rendered as its own pill next to the
   * name — independent of author_is_admin, so an admin who is also a
   * supervisor shows both. Attached by the read/list controller, not
   * persisted.
   */
  author_official_type?: string | null;
  author_official_title?: string | null;
  body: string;
  submitted_at: string; // ISO 8601
  phase: CommentPhase | null;
  /**
   * Slice 11 — moderation state. Null when the comment has never been
   * moderated. When `hidden` is true, public read-models redact `body`
   * to a tombstone string; admins still receive the original body and
   * the reason. A restore reverses the action — `hidden` flips back to
   * false and `restored_at` records when. The full audit trail lives
   * in the events table (civic.process.updated with restricted
   * visibility), not here — these columns reflect only the most recent
   * action.
   */
  moderation: CommentModeration | null;
}

/**
 * Reason chips offered in the admin "Hide a comment" modal. Mostly
 * informational — the chosen value is stored verbatim in the event's
 * data.moderation.reason and in community_inputs.hidden_reason. "Other"
 * lets an admin write a custom reason.
 */
export interface CommentModeration {
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  reason: string | null;
  restored_at: string | null;
}

/** Max characters in an admin-supplied moderation reason. */
export const MODERATION_REASON_MAX = 500;

/**
 * Event emission callback — injected by the host hub. Mirrors the pattern
 * used by civic.vote: the module never imports the hub's event system
 * directly, keeping it portable across hubs.
 *
 * Returns a Promise so the host hub can durably store the event before
 * the caller proceeds. Callers should always `await` emissions.
 */
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
    /**
     * Slice 11 — moderation events are emitted with restricted
     * visibility so they never leak to the public /events feed or the
     * resident-facing digest. Defaults to "public" when omitted.
     */
    visibility?: "public" | "restricted";
  }): Promise<unknown>;
}

/**
 * Context provided by the hub when submitting input, so the module can
 * emit a spec-compliant event without knowing the hub's identity.
 */
export interface InputContext {
  hub_id: string;
  jurisdiction: string;
  emit: EmitEventFn;
}

/** Max length of `body_preview` carried in comment_added event data. */
export const BODY_PREVIEW_LEN = 200;
