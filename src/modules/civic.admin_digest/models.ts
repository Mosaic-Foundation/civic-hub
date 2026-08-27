// civic.admin_digest — models for the admin-facing daily digest.
//
// Operator-side notification: counts of pending items in each
// admin-review queue (proposals, vote results, meeting summaries),
// plus resident feedback received since the last digest, sent once a
// day to every admin in CIVIC_ADMIN_EMAILS. NOT a civic event — does
// not flow through emitEvent() / /events.

export interface PendingItemSummary {
  /** Process or proposal id used to deep-link to the admin detail page. */
  id: string;
  /**
   * Display title — truncated by the renderer if too long. Feedback has
   * no title, so it passes a one-line excerpt of the message here.
   */
  title: string;
  /** ISO timestamp when the item entered the queue (created_at usually). */
  created_at: string;
}

export interface QueueSnapshot {
  /** Total pending items in the queue (post-filter, pre-truncation). */
  count: number;
  /**
   * Up to N most-recent items for display in the email body. Empty when
   * count is zero. Capped to keep the email scannable; admins click
   * through to the panel for the full list.
   */
  items: PendingItemSummary[];
  /** Absolute URL to the admin index page for this queue. */
  panel_url: string;
}

export interface AdminDigestPayload {
  hub_name: string;
  generated_at: string;
  proposals: QueueSnapshot;
  vote_results: QueueSnapshot;
  meeting_summaries: QueueSnapshot;
  /**
   * Feedback received in the digest window (the last 24h), not a backlog
   * of unhandled items. Feedback has no pending/resolved state — it is an
   * archive, not a queue — so "count" here means "new since yesterday".
   * That keeps the digest from re-reporting the same submissions daily
   * forever, and needs no seen/handled column to do it.
   */
  feedback: QueueSnapshot;
  /** True when every queue is empty — caller should skip the send. */
  empty: boolean;
}
