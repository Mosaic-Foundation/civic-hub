// Dashboard section "Waiting for attention": per hub, what is pending now.
//
// Not the admin tabs' badges: those count what is NEW since one admin last
// opened a tab (src/services/adminQueues.ts), and drop to zero once anyone
// looks. This counts what is still waiting, with the same database function
// for reviews (count_pending_reviews, from the beginning of time) and the
// same rules as the badges otherwise: a switched-off plugin's queue is not
// counted (null, shown as a dash), and a list's hidden statuses are left out.
//
//   reviews            pending process reviews
//   briefs             briefs and vote results awaiting publication
//   meeting_summaries  meeting summaries awaiting approval
//   feedback           feedback received in the last FEEDBACK_DAYS days (feedback has no "done" state)
//   waitlist           waitlist entries not yet told the hub is open
//   flagged            "Flagged by checks": pending reviews the Code of Conduct
//                      check flagged, plus pending meeting summaries with a
//                      quality flag. Not resident reports; there are none yet.
//
// Each count links to that hub's own queue on its hostname; the hub asks for
// sign-in there if needed. Archived hubs are left out. Counts only.

import { env } from "../../config/env.js";
import { forHub } from "../../db/forHub.js";
import { currentHubId } from "../../config/hubContext.js";
import { disabledProcessTypes, isProcessTypeEnabled } from "../../services/pluginGate.js";
import { isPluginEnabledSync } from "../../services/hubSettings.js";
import { nonPublicStatusFilter } from "../../services/processLifecycle.js";
import { hubOrigin } from "../../utils/baseUrl.js";
import { listHubs, type ControlHub } from "../hubs.js";
import { inHubScope } from "../inHub.js";
import { HUB_GROUP_ORDER, hubGroup, type HubGroup } from "./hubs.js";
import type { SectionContext } from "./registry.js";

export const FEEDBACK_DAYS = 7;
const EPOCH = "1970-01-01T00:00:00.000Z";

export const ATTENTION_QUEUES = ["reviews", "briefs", "meeting_summaries", "feedback", "waitlist", "flagged"] as const;
export type AttentionQueue = (typeof ATTENTION_QUEUES)[number];

/** Where each count leads, on the hub's own hostname. */
export const QUEUE_PATHS: Record<AttentionQueue, string> = {
  reviews: "/admin/reviews",
  briefs: "/admin/briefs",
  meeting_summaries: "/admin/meeting-summaries",
  feedback: "/admin/feedback",
  waitlist: "/admin/settings/mode#waitlist",
  flagged: "/admin/reviews",
};

export interface AttentionRow {
  id: string;
  name: string;
  mode: string | null;
  group: HubGroup;
  /** null: that queue's plugin is off on this hub. */
  counts: Record<AttentionQueue, number | null>;
  links: Record<AttentionQueue, string>;
  total: number;
  /** Set when the hub's counts could not be read; the other hubs still show. */
  error?: string;
}

export interface AttentionSection {
  feedback_days: number;
  hubs: AttentionRow[];
}

async function pendingProcesses(types: string[], stateKey: string, flaggedOnly = false): Promise<number | null> {
  const enabled = types.filter((t) => isProcessTypeEnabled(t));
  if (enabled.length === 0) return null;
  let q = forHub(currentHubId())
    .from("processes")
    .count()
    .in("type", enabled)
    .not("status", "in", nonPublicStatusFilter())
    .eq(`state->>${stateKey}`, "pending");
  // ->> : a summary with no flag stores JSON null, which -> would read as a
  // value; as text it is SQL NULL.
  if (flaggedOnly) q = q.not("state->>quality_flag", "is", null);
  return q;
}

/**
 * Pending reviews the Code of Conduct check flagged, leaving out reviews of a
 * switched-off type's processes as count_pending_reviews does. Flagged reviews
 * are few, so their processes are read and the switched-off ones dropped.
 */
async function countFlaggedReviews(): Promise<number> {
  const db = forHub(currentHubId());
  const excluded = disabledProcessTypes();
  if (excluded.length === 0) {
    return db.from("process_reviews").count().eq("status", "pending_review").not("coc_flags", "is", null);
  }
  const rows = await db
    .from("process_reviews")
    .select<{ process_id: string }>("process_id")
    .eq("status", "pending_review")
    .not("coc_flags", "is", null)
    .limit(1000);
  if (rows.length === 0) return 0;
  const ids = [...new Set(rows.map((r) => r.process_id))];
  const off = await db.from("processes").select<{ id: string }>("id").in("id", ids).in("type", excluded);
  const offIds = new Set(off.map((p) => p.id));
  return rows.filter((r) => !offIds.has(r.process_id)).length;
}

async function hubCounts(now: Date): Promise<Record<AttentionQueue, number | null>> {
  const db = forHub(currentHubId());
  const since = new Date(now.getTime() - FEEDBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [reviews, briefs, meetingSummaries, feedback, waitlist, flaggedReviews, flaggedSummaries] = await Promise.all([
    db
      .rpc<number | string>("count_pending_reviews", { p_since: EPOCH, p_excluded_types: disabledProcessTypes() })
      .then(Number),
    pendingProcesses(["civic.brief", "civic.vote_results"], "publication_status"),
    pendingProcesses(["civic.meeting_summary"], "approval_status"),
    isPluginEnabledSync("feedback") ? db.from("feedback_submissions").count().gte("created_at", since) : null,
    db.from("waitlist").count().is("told_open_at", null),
    countFlaggedReviews(),
    pendingProcesses(["civic.meeting_summary"], "approval_status", true),
  ]);
  return {
    reviews,
    briefs,
    meeting_summaries: meetingSummaries,
    feedback,
    waitlist,
    flagged: flaggedReviews + (flaggedSummaries ?? 0),
  };
}

function links(hostname: string): Record<AttentionQueue, string> {
  const origin = hubOrigin(hostname, env.CIVIC_UI_BASE_URL ?? env.BASE_URL ?? "http://localhost:3000");
  return Object.fromEntries(ATTENTION_QUEUES.map((q) => [q, `${origin}${QUEUE_PATHS[q]}`])) as Record<AttentionQueue, string>;
}

const EMPTY = Object.fromEntries(ATTENTION_QUEUES.map((q) => [q, null])) as Record<AttentionQueue, number | null>;

async function attentionRow(hub: ControlHub, now: Date): Promise<AttentionRow> {
  const base = { id: hub.id, name: hub.name, mode: hub.mode, group: hubGroup(hub), links: links(hub.hostname) };
  try {
    const counts = await inHubScope(hub.id, () => hubCounts(now));
    // Flagged items are already among the reviews and summaries: not added twice.
    const total = ATTENTION_QUEUES.filter((q) => q !== "flagged").reduce((sum, q) => sum + (counts[q] ?? 0), 0);
    return { ...base, counts, total };
  } catch (err) {
    console.warn(`[dashboard] attention counts for ${hub.id} failed:`, err);
    return { ...base, counts: EMPTY, total: 0, error: "Counts could not be read." };
  }
}

export async function loadAttention(ctx: SectionContext): Promise<AttentionSection> {
  const hubs = (await listHubs()).filter((h) => !h.archived_at);
  const rows = await Promise.all(hubs.map((h) => attentionRow(h, ctx.now)));
  rows.sort(
    (a, b) => HUB_GROUP_ORDER.indexOf(a.group) - HUB_GROUP_ORDER.indexOf(b.group) || a.name.localeCompare(b.name),
  );
  return { feedback_days: FEEDBACK_DAYS, hubs: rows };
}
