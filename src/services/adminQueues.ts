// Admin queue counts — the numbers on the admin tabs and the admin's
// account-menu dot.
//
// Every count is NEW SINCE YOU LAST OPENED THAT TAB (Adam, 2026-09-06: "I
// want it to be only a count of new stuff. New is defined by items that I
// haven't viewed" — some things linger in a queue on purpose, and a badge
// that stays lit for them is a false signal). Each tab has a per-admin
// cursor on users (<queue>_seen_at); opening the tab stamps it. Reviews and
// Edits had theirs already; Briefs, Meeting summaries and Feedback got one
// on 2026-09-06 (migration 20260906180000).
//
// Moderation is a read-only log and has no count.

import { getDb } from "../db/client.js";
import { getAllProcesses } from "./processService.js";
import { listAllEdits } from "./editNotifications.js";

const EPOCH = "1970-01-01T00:00:00.000Z";

export const ADMIN_QUEUES = ["reviews", "briefs", "meeting_summaries", "feedback", "edits"] as const;
export type AdminQueue = (typeof ADMIN_QUEUES)[number];

/** The users column that holds each tab's "last opened" cursor. */
const SEEN_COLUMN: Record<AdminQueue, string> = {
  reviews: "reviews_seen_at",
  briefs: "briefs_seen_at",
  meeting_summaries: "meeting_summaries_seen_at",
  feedback: "feedback_seen_at",
  edits: "edits_seen_at",
};

export function isAdminQueue(value: unknown): value is AdminQueue {
  return typeof value === "string" && (ADMIN_QUEUES as readonly string[]).includes(value);
}

export type AdminQueueCounts = Record<AdminQueue, number> & { total: number };

export async function getAdminQueueCounts(userId: string): Promise<AdminQueueCounts> {
  const db = getDb();

  const { data: userRow, error: uErr } = await db
    .from("users")
    .select(Object.values(SEEN_COLUMN).join(", "))
    .eq("id", userId)
    .maybeSingle();
  if (uErr) throw new Error(`Queue counts (cursors): ${uErr.message}`);
  const seen = (queue: AdminQueue): string =>
    ((userRow as Record<string, string | null> | null)?.[SEEN_COLUMN[queue]]) ?? EPOCH;

  // Reviews: pending ones that arrived or changed since the tab was opened.
  const { count: reviews, error: rErr } = await db
    .from("process_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review")
    .gt("updated_at", seen("reviews"));
  if (rErr) throw new Error(`Queue counts (reviews): ${rErr.message}`);

  // Briefs and meeting summaries: pending ones generated since the tab was
  // opened. One pass over processes; volume is small.
  let briefs = 0;
  let meetingSummaries = 0;
  const briefsSeen = seen("briefs");
  const summariesSeen = seen("meeting_summaries");
  for (const proc of await getAllProcesses()) {
    const state = proc.state as
      | { publication_status?: unknown; approval_status?: unknown }
      | null
      | undefined;
    const type = proc.definition.type;
    if (
      (type === "civic.brief" || type === "civic.vote_results") &&
      state?.publication_status === "pending" &&
      proc.createdAt > briefsSeen
    ) {
      briefs += 1;
    } else if (
      type === "civic.meeting_summary" &&
      state?.approval_status === "pending" &&
      proc.createdAt > summariesSeen
    ) {
      meetingSummaries += 1;
    }
  }

  const { count: feedback, error: fErr } = await db
    .from("feedback_submissions")
    .select("id", { count: "exact", head: true })
    .gt("created_at", seen("feedback"));
  if (fErr) throw new Error(`Queue counts (feedback): ${fErr.message}`);

  const edits = (await listAllEdits(userId)).unseen;

  const counts: Record<AdminQueue, number> = {
    reviews: reviews ?? 0,
    briefs,
    meeting_summaries: meetingSummaries,
    feedback: feedback ?? 0,
    edits,
  };
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Opening a tab: everything in that queue up to now has been seen. */
export async function markAdminQueueSeen(userId: string, queue: AdminQueue): Promise<void> {
  const { error } = await getDb()
    .from("users")
    .update({ [SEEN_COLUMN[queue]]: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`Queue counts (${queue} seen): ${error.message}`);
}
