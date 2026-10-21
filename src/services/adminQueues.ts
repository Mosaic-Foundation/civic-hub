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
//
// A queue whose plugin the hub switched off counts zero: its tab is gone, so
// a number would light the badge for something the admin cannot open. Pending
// reviews of a switched-off type are left out the same way.
//
// Every number is counted by the database, not by reading the rows (the
// cleanup slice): a long-used hub has thousands of reviews, past PostgREST's
// 1,000-row cap.

import { forHub, type HubDb } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { disabledProcessTypes, isProcessTypeEnabled } from "./pluginGate.js";
import { nonPublicStatusFilter } from "./processLifecycle.js";
import { isPluginEnabledSync } from "./hubSettings.js";
import { countUnseenEdits } from "./editNotifications.js";
import { queueTypeGroups } from "./publicationQueues.js";
import type { PublicationQueue } from "../processes/manifest.js";

/** The hub in scope. Queue counts are only ever read or stamped inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

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
  const userRow = await db()
    .from("users")
    .select<Record<string, string | null>>(Object.values(SEEN_COLUMN).join(", "))
    .eq("id", userId)
    .maybeSingle();
  const seen = (queue: AdminQueue): string => userRow?.[SEEN_COLUMN[queue]] ?? EPOCH;

  // Reviews: pending ones that arrived or changed since the tab was opened.
  const reviews = Number(
    await db().rpc<number | string>("count_pending_reviews", {
      p_since: seen("reviews"),
      p_excluded_types: disabledProcessTypes(),
    }),
  );

  // Briefs and meeting summaries: pending ones generated since the tab was
  // opened, among the processes a list shows.
  const pendingSince = (types: string[], stateKey: string, since: string): PromiseLike<number> | number => {
    const enabled = types.filter((t) => isProcessTypeEnabled(t));
    if (enabled.length === 0) return 0;
    return db()
      .from("processes")
      .count()
      .in("type", enabled)
      .not("status", "in", nonPublicStatusFilter())
      .eq(`state->>${stateKey}`, "pending")
      .gt("created_at", since);
  };
  const pendingInQueue = async (queue: PublicationQueue, since: string): Promise<number> => {
    const counts = await Promise.all(
      queueTypeGroups(queue).map((g) => pendingSince(g.types, g.field, since)),
    );
    return counts.reduce<number>((sum, n) => sum + Number(n), 0);
  };
  const [briefs, meetingSummaries] = await Promise.all([
    pendingInQueue("briefs", seen("briefs")),
    pendingInQueue("meeting_summaries", seen("meeting_summaries")),
  ]);

  const feedback = isPluginEnabledSync("feedback")
    ? await db().from("feedback_submissions").count().gt("created_at", seen("feedback"))
    : 0;

  const edits = await countUnseenEdits(userId);

  const counts: Record<AdminQueue, number> = {
    reviews,
    briefs,
    meeting_summaries: meetingSummaries,
    feedback,
    edits,
  };
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Opening a tab: everything in that queue up to now has been seen. */
export async function markAdminQueueSeen(userId: string, queue: AdminQueue): Promise<void> {
  await db()
    .from("users")
    .update({ [SEEN_COLUMN[queue]]: new Date().toISOString() })
    .eq("id", userId);
}
