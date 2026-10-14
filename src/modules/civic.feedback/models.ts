// civic.feedback — operator-facing product feedback.
//
// NOT a civic event. This module exists alongside civic.* siblings
// for naming consistency only — feedback submissions persist in their
// own table and never flow through emitEvent(). Public /events readers
// must not see this surface.

// "topic" is resident-facing in a way the others are not: it collects
// subjects the Hub should take up, so an operator choosing launch content
// can read them as a group. Kept in this list — not a separate surface —
// so it reuses the one feedback form, validator, and table.
export type FeedbackCategory =
  | "idea"
  | "topic"
  | "bug"
  | "moderation"
  | "general";

export const FEEDBACK_CATEGORIES: ReadonlyArray<FeedbackCategory> = [
  "idea",
  "topic",
  "bug",
  "moderation",
  "general",
];

export interface FeedbackSubmission {
  id: string;
  created_at: string;
  category: FeedbackCategory;
  message: string;
  name: string | null;
  email: string | null;
  user_id: string | null;
  user_agent: string | null;
  /** Optional screenshot on a bug report — public URL in the image bucket. */
  screenshot_url: string | null;
  /** The path the sender came from (no query string); null before 2026-10-13. */
  page_path: string | null;
  /** The deployed commit that received it, stamped by the server. */
  software_version: string | null;
  /** "Civic.Social may contact me about this". */
  contact_ok: boolean;
  /** Civic.Social's copy, when the item was shared (Bug, Idea, or forwarded). */
  mosaic: MosaicCopy | null;
}

/** What the hub knows of Civic.Social's copy: enough for the badge. */
export interface MosaicCopy {
  stream: MosaicHubStream;
  status: "received" | "planned" | "fixed";
  sent_at: string;
  sent_by: "sender" | "admin";
}

/** The two streams a hub item can go to; an admin's own message is a third, console-only. */
export type MosaicHubStream = "bug" | "feature";

/**
 * Which categories are about how the site works (Adam's design, 2026-10-08):
 * Bug and Idea go to Civic.Social as well as the hub; the rest are the hub's.
 */
export const SOFTWARE_STREAM: Readonly<Partial<Record<FeedbackCategory, MosaicHubStream>>> = {
  bug: "bug",
  idea: "feature",
};

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  message: string;
  name?: string | null;
  email?: string | null;
  user_id?: string | null;
  user_agent?: string | null;
  screenshot_url?: string | null;
  page_path?: string | null;
  contact_ok?: boolean;
}
