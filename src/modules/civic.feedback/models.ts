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
}

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  message: string;
  name?: string | null;
  email?: string | null;
  user_id?: string | null;
  user_agent?: string | null;
}
