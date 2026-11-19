// Admin queue counts — the numbers on the admin tabs and the admin's
// account-menu dot.
//
// Every count is NEW SINCE YOU LAST OPENED THAT TAB (Adam, 2026-09-06: "I
// want it to be only a count of new stuff. New is defined by items that I
// haven't viewed" — some things linger in a queue on purpose, and a badge
// that stays lit for them is a false signal). Each tab has a per-admin
// cursor on users (<queue>_seen_at); opening the tab stamps it. Reviews and
// Edits had theirs already; Briefs, Meeting summaries and Feedback got one
// on 2026-09-06 (migration 20260906180000). Since kernel step 3 a package
// names its own queue, and its cursor is kept under that name; since step 4 a
// feature plugin does too (FeatureServer.queues: Feedback's; migration
// 20261119210000 carried feedback_seen_at over).
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
import { countPendingByState } from "./processRows.js";
import { countUnseenEdits } from "./editNotifications.js";
import { queueTypeGroups } from "./publicationQueues.js";
import { publicationQueues } from "../processes/registry.js";
import { featureQueues } from "../plugins/features.js";
import type { PublicationQueue } from "../processes/manifest.js";

/** The hub in scope. Queue counts are only ever read or stamped inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * The kernel's own queues, each with its users column. A package's queue
 * (its manifest's publication.queue: "briefs", "meeting_summaries") keeps its
 * cursor under its name in users.queues_seen_at (kernel step 3; migration
 * 20261117200000 moved the two there were).
 */
const KERNEL_QUEUES = {
  reviews: "reviews_seen_at",
  edits: "edits_seen_at",
} as const;
type KernelQueue = keyof typeof KERNEL_QUEUES;

/** A queue name: the kernel's two, a mounted package's or a feature's. */
export type AdminQueue = KernelQueue | PublicationQueue | string;

/** Every queue an admin tab can open: the kernel's, the packages' in the manifests' order, then the features'. */
export function adminQueues(): string[] {
  return [...Object.keys(KERNEL_QUEUES), ...publicationQueues(), ...featureQueues().map((f) => f.queue.name)];
}

function isKernelQueue(queue: string): queue is KernelQueue {
  return Object.hasOwn(KERNEL_QUEUES, queue);
}

export function isAdminQueue(value: unknown): value is AdminQueue {
  return typeof value === "string" && adminQueues().includes(value);
}

export type AdminQueueCounts = Record<string, number> & { total: number };

export async function getAdminQueueCounts(userId: string): Promise<AdminQueueCounts> {
  const userRow = await db()
    .from("users")
    .select<Record<string, unknown>>([...Object.values(KERNEL_QUEUES), "queues_seen_at"].join(", "))
    .eq("id", userId)
    .maybeSingle();
  const packageSeen = (userRow?.queues_seen_at ?? {}) as Record<string, unknown>;
  const seen = (queue: AdminQueue): string => {
    const at = isKernelQueue(queue) ? userRow?.[KERNEL_QUEUES[queue]] : packageSeen[queue];
    return typeof at === "string" && at ? at : EPOCH;
  };

  // Reviews: pending ones that arrived or changed since the tab was opened.
  const reviews = Number(
    await db().rpc<number | string>("count_pending_reviews", {
      p_since: seen("reviews"),
      p_excluded_types: disabledProcessTypes(),
    }),
  );

  // A package's queue: pending records generated since the tab was opened,
  // among the processes a list shows.
  const pendingSince = (types: string[], stateKey: string, since: string): PromiseLike<number> | number => {
    const enabled = types.filter((t) => isProcessTypeEnabled(t));
    if (enabled.length === 0) return 0;
    return countPendingByState(enabled, stateKey, { since });
  };
  const pendingInQueue = async (queue: PublicationQueue): Promise<number> => {
    const counts = await Promise.all(
      queueTypeGroups(queue).map((g) => pendingSince(g.types, g.field, seen(queue))),
    );
    return counts.reduce<number>((sum, n) => sum + Number(n), 0);
  };
  const queues = publicationQueues();
  const packageCounts = await Promise.all(queues.map((q) => pendingInQueue(q)));

  // A feature's queue, while it is on (Feedback's).
  const features = featureQueues();
  const featureCounts = await Promise.all(features.map((f) => (f.on() ? f.queue.count(seen(f.queue.name)) : 0)));

  const edits = await countUnseenEdits(userId);

  const counts: Record<string, number> = { reviews };
  queues.forEach((q, i) => (counts[q] = packageCounts[i] ?? 0));
  features.forEach((f, i) => (counts[f.queue.name] = Number(featureCounts[i] ?? 0)));
  counts.edits = edits;
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Opening a tab: everything in that queue up to now has been seen. */
export async function markAdminQueueSeen(userId: string, queue: AdminQueue): Promise<void> {
  const now = new Date().toISOString();
  if (isKernelQueue(queue)) {
    await db().from("users").update({ [KERNEL_QUEUES[queue]]: now }).eq("id", userId);
    return;
  }
  // A package's queue: its name's entry in queues_seen_at, the others kept.
  const row = await db().from("users").select<{ queues_seen_at: Record<string, string> | null }>("queues_seen_at").eq("id", userId).maybeSingle();
  await db()
    .from("users")
    .update({ queues_seen_at: { ...(row?.queues_seen_at ?? {}), [queue]: now } })
    .eq("id", userId);
}
