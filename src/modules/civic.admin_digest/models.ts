// civic.admin_digest — models for the email to a hub's admins.
//
// A TALLY OF WHAT IS NEW SINCE THE LAST ONE (leaving-demo slice, 2026-10-15).
// One line per category, each a count and a link to that queue on the hub:
//
//   3 new process reviews (8 waiting, 1 flagged by the check)
//   2 new meeting summaries (2 waiting)
//   No new briefs (4 waiting)
//
// "New" means it arrived after the moment the last digest that went out
// covered up to (admin_digest_marks), by a timestamp that never changes once
// written, so no item is ever counted new twice and a missed day loses
// nothing. New is what sends the email; nothing goes out when nothing is new,
// and "waiting" is never a reason to send (Adam, 2026-10-15). Waiting is there
// so an admin who let a queue pile up sees the pile.
//
// Operator-side: NOT a civic event, does not flow through emitEvent() / /events.

export type DigestLineId =
  | "job_problems"
  | "reviews"
  | "briefs"
  | "meeting_summaries"
  | "feedback"
  | "edits"
  | "waitlist";

export interface DigestLine {
  id: DigestLineId;
  /** The noun, singular and plural: "process review" / "process reviews". */
  noun: { one: string; many: string };
  /** Arrived since the last digest's mark. */
  new_count: number;
  /** Everything in the queue now, new or not; null for a category with no queue (feedback, edits, jobs). */
  waiting: number | null;
  /** Of the new ones, how many were flagged (the Code of Conduct check, a meeting summary's quality flag). */
  flagged: number;
  /** What "flagged" means on this line, when it can be non-zero. */
  flagged_by?: string;
  /** Absolute URL of the queue on the hub. */
  url: string;
}

export interface AdminDigestPayload {
  hub_name: string;
  /** The window: after `since`, up to and including `until` (ISO 8601). */
  since: string;
  until: string;
  /** Every category the hub has, in order; a switched-off plugin's is left out. */
  lines: DigestLine[];
  /** Sum of new_count over the lines. */
  new_total: number;
  /** Nothing new: the caller sends nothing. */
  empty: boolean;
}
