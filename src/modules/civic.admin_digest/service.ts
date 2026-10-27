// civic.admin_digest service — count, render, send (see models.ts).
//
// THE RULE (leaving-demo slice, 2026-10-15): each email covers only what is
// new since the last one, across everything an admin reviews, and never
// repeats an item. Before, the review queues were re-listed every day while
// they waited, and feedback and job problems used a fixed 24-hour window, so a
// doubled run repeated them and a missed one lost them.
//
// How it holds:
//   - The window runs from the mark the last digest that went out left
//     (admin_digest_marks.covered_until) to the moment this run started. The
//     first run on a hub looks back one day.
//   - Every category is counted by a time that never changes once written:
//     a review's latest submission turn (review_turns are append-only), a
//     brief's or meeting summary's creation, a feedback item's, a waitlist
//     signup's, an edit event's, a job run's finish. An item falls in exactly
//     one window.
//   - The run claims its window before counting, with a compare-and-set on the
//     mark, so two runs at once (the cron and a manual run) can't both send
//     it. If nothing could be delivered, the claim is given back.
//
// The body is a tally: one line per category, new and waiting, each a link to
// that queue. Nothing is sent when nothing is new; waiting alone never sends.
// The old "Open proposals" section is gone (live idea-board items, not an
// admin queue), and so is "Vote results awaiting approval" (since 2026-10-07).

import {
  countFeedback,
  editEvents,
  latestSubmissions,
  moveMark,
  readMark,
  releaseMark,
  waitlistRows,
} from "./store.js";
import { getAllProcesses, getSampleProcessIds } from "../../services/processService.js";
import { getManifest, publicationOf, typesPublishedThrough } from "../../processes/registry.js";
import { listReviews } from "../civic.review/index.js";
import { effectiveQualityFlag } from "../../../packages/civic.meeting_summary/api.js";
import { sendEmail } from "../../utils/email.js";
import { uiBaseUrl } from "../../utils/baseUrl.js";
import { getSettingSync, hubDisplayNameSync, hubModeSync, isPluginEnabledSync } from "../../services/hubSettings.js";
import { KEYS, asEmailList } from "../../models/hubSettings.js";
import { isSubstantiveEdit } from "../../services/processEdits.js";
import { jobProblemsSince } from "../../services/jobRuns.js";
import type { AdminDigestPayload, DigestLine } from "./models.js";
import { featureDigestLines } from "../../plugins/features.js";

/** A hub's first digest looks back this far. */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

/** In (since, until], by instant: the database writes "+00:00", JavaScript "Z". */
function within(t: string | null | undefined, since: string, until: string): boolean {
  if (!t) return false;
  const at = Date.parse(t);
  return at > Date.parse(since) && at <= Date.parse(until);
}

/** Human names for the jobs an admin sees; ids in src/jobs/registry.ts. */
export const JOB_NAMES: Readonly<Record<string, string>> = {
  meeting_summary: "Meeting summaries",
  news_sync: "News sync",
  digest: "Email digest",
  admin_digest: "Admin digest",
  vote_close: "Closing at deadlines",
  sample_refresh: "Sample refresh",
  job_runs: "Job run log",
};

// --- Counting -----------------------------------------------------------------

async function reviewsLine(since: string, until: string, sampleIds: ReadonlySet<string>, ui: string): Promise<DigestLine> {
  const pending = (await listReviews("pending_review")).filter((r) => !sampleIds.has(r.process_id));
  const latest = await latestSubmissions(pending.map((r) => r.id));
  const fresh = pending.filter((r) => within(latest.get(r.id) ?? r.created_at, since, until));
  return {
    id: "reviews",
    noun: { one: "process review", many: "process reviews" },
    new_count: fresh.length,
    waiting: pending.length,
    flagged: fresh.filter((r) => (r.coc_flags?.length ?? 0) > 0).length,
    flagged_by: "the Code of Conduct check",
    url: `${ui}/admin/reviews`,
  };
}

async function briefAndSummaryLines(since: string, until: string, ui: string): Promise<DigestLine[]> {
  const on = { briefs: isPluginEnabledSync("brief"), summaries: isPluginEnabledSync("meeting_summary") };
  // Briefs are the published-through-"briefs" types that summarize another
  // process (not a vote's results record); summaries are the other queue's.
  const briefTypes = typesPublishedThrough("briefs").filter((t) => getManifest(t)?.summarizes);
  const summaryTypes = typesPublishedThrough("meeting_summaries");
  const types = [...(on.briefs ? briefTypes : []), ...(on.summaries ? summaryTypes : [])];
  if (types.length === 0) return [];
  const procs = (await getAllProcesses(types)).filter((p) => !p.isSample);
  const briefs = { new_count: 0, waiting: 0 };
  const summaries = { new_count: 0, waiting: 0, flagged: 0 };
  for (const p of procs) {
    const state = p.state as Record<string, unknown> | null | undefined;
    const fresh = within(p.createdAt, since, until);
    const type = p.definition.type;
    if (briefTypes.includes(type) && state?.[publicationOf(type)?.field ?? ""] === "pending") {
      briefs.waiting += 1;
      if (fresh) briefs.new_count += 1;
    } else if (summaryTypes.includes(type) && state?.[publicationOf(type)?.field ?? ""] === "pending") {
      summaries.waiting += 1;
      if (fresh) {
        summaries.new_count += 1;
        if (effectiveQualityFlag(state as unknown as Parameters<typeof effectiveQualityFlag>[0])) summaries.flagged += 1;
      }
    }
  }
  const lines: DigestLine[] = [];
  if (on.briefs) {
    lines.push({
      id: "briefs",
      noun: { one: "brief to approve", many: "briefs to approve" },
      ...briefs,
      flagged: 0,
      url: `${ui}/admin/briefs`,
    });
  }
  if (on.summaries) {
    lines.push({
      id: "meeting_summaries",
      noun: { one: "meeting summary", many: "meeting summaries" },
      ...summaries,
      flagged_by: "its quality check",
      url: `${ui}/admin/meeting-summaries`,
    });
  }
  return lines;
}

async function feedbackLine(since: string, until: string, ui: string): Promise<DigestLine | null> {
  if (!isPluginEnabledSync("feedback")) return null;
  const n = await countFeedback(since, until);
  return {
    id: "feedback",
    noun: { one: "feedback message", many: "feedback messages" },
    new_count: n,
    waiting: null,
    flagged: 0,
    url: `${ui}/admin/feedback`,
  };
}

async function editsLine(since: string, until: string, sampleIds: ReadonlySet<string>, ui: string): Promise<DigestLine> {
  const events = await editEvents(since, until);
  const n = events.filter((e) => {
    if (sampleIds.has(e.process_id)) return false;
    const edit = (e.data as { edit?: Parameters<typeof isSubstantiveEdit>[0] } | null)?.edit;
    return !!edit && isSubstantiveEdit(edit);
  }).length;
  return {
    id: "edits",
    noun: { one: "edit to a live process", many: "edits to live processes" },
    new_count: n,
    waiting: null,
    flagged: 0,
    url: `${ui}/admin/edits`,
  };
}

async function waitlistLine(since: string, until: string, ui: string): Promise<DigestLine> {
  const rows = await waitlistRows();
  // Waiting means something only in beta: people not yet let in.
  const allowed = new Set(asEmailList(getSettingSync(KEYS.BETA_ALLOWLIST)));
  const waiting = hubModeSync() === "beta" ? rows.filter((r) => !allowed.has(r.email.toLowerCase()) && !r.told_open_at).length : null;
  return {
    id: "waitlist",
    noun: { one: "person on the waitlist", many: "people on the waitlist" },
    new_count: rows.filter((r) => within(r.created_at, since, until)).length,
    waiting,
    flagged: 0,
    url: `${ui}/admin/settings/mode#waitlist`,
  };
}

async function jobsLine(since: string, until: string, ui: string): Promise<DigestLine> {
  let n = 0;
  try {
    n = (await jobProblemsSince(since)).filter(
      (r) => (r.status === "failed" || r.status === "flagged") && r.finished_at <= until,
    ).length;
  } catch (err) {
    // Not being able to read the log is itself worth an admin's look.
    console.warn(`[admin-digest] Job run log unavailable: ${err instanceof Error ? err.message : String(err)}`);
    n = 1;
  }
  return {
    id: "job_problems",
    noun: { one: "scheduled job problem", many: "scheduled job problems" },
    new_count: n,
    waiting: null,
    flagged: 0,
    url: `${ui}/admin/settings/plugins`,
  };
}

/**
 * Count every category for the window (since, until]. A category whose plugin
 * the hub switched off is left out: its queue's page is gone. Process reviews,
 * edits, the waitlist and job problems belong to no plugin.
 */
export async function buildAdminDigest(since: string, until: string): Promise<AdminDigestPayload> {
  const ui = uiBaseUrl();
  // Sample content (Phase 7) never asks an admin for anything.
  const sampleIds = await getSampleProcessIds();
  const lines: DigestLine[] = [];
  lines.push(await jobsLine(since, until, ui));
  lines.push(await reviewsLine(since, until, sampleIds, ui));
  lines.push(...(await briefAndSummaryLines(since, until, ui)));
  const feedback = await feedbackLine(since, until, ui);
  if (feedback) lines.push(feedback);
  lines.push(await editsLine(since, until, sampleIds, ui));
  lines.push(await waitlistLine(since, until, ui));
  const new_total = lines.reduce((sum, l) => sum + l.new_count, 0);
  const notes = await featureNotes(new Date(until));
  return { hub_name: hubDisplayNameSync(), since, until, lines, new_total, notes, empty: new_total === 0 && notes.length === 0 };
}

// --- Rendering ----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function noun(line: DigestLine, n: number): string {
  return n === 1 ? line.noun.one : line.noun.many;
}

/** "3 new process reviews (8 waiting, 1 flagged by the Code of Conduct check)". Pure. */
export function digestLineText(line: DigestLine): string {
  const head = line.new_count > 0 ? `${line.new_count} new ${noun(line, line.new_count)}` : `No new ${line.noun.many}`;
  const extra: string[] = [];
  if (line.waiting !== null) extra.push(`${line.waiting} waiting`);
  if (line.flagged > 0) extra.push(`${line.flagged} flagged by ${line.flagged_by ?? "a check"}`);
  return extra.length > 0 ? `${head} (${extra.join(", ")})` : head;
}

/** The lines an email shows: anything new, and any queue with something waiting. */
export function shownLines(p: AdminDigestPayload): DigestLine[] {
  return p.lines.filter((l) => l.new_count > 0 || (l.waiting ?? 0) > 0);
}

/** Each switched-on feature's line for this digest; one that fails is reported and left out. */
async function featureNotes(now: Date): Promise<string[]> {
  const out: string[] = [];
  for (const { feature, line } of featureDigestLines()) {
    if (!isPluginEnabledSync(feature)) continue;
    try {
      const text = await line({ now });
      if (text) out.push(text);
    } catch (err) {
      console.warn(`[admin-digest] the ${feature} line failed: ${(err as Error).message}`);
    }
  }
  return out;
}

export function renderAdminDigestEmail(p: AdminDigestPayload): { subject: string; html: string; text: string } {
  const newParts = p.lines.filter((l) => l.new_count > 0).map((l) => `${l.new_count} ${noun(l, l.new_count)}`);
  const subject =
    p.new_total > 0 ? `[${p.hub_name}] ${p.new_total} new for admins: ${newParts.join(", ")}` : `[${p.hub_name}] Last month's activity`;
  const notes = p.notes ?? [];
  const lines = shownLines(p);
  const items = lines
    .map(
      (l) =>
        `<li style="margin:0 0 10px;line-height:1.4;"><a href="${escapeHtml(l.url)}" style="color:#1e3a5f;${
          l.new_count > 0 ? "font-weight:600;" : ""
        }">${escapeHtml(digestLineText(l))}</a></li>`,
    )
    .join("");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#1e3a5f;">${escapeHtml(p.hub_name)}: what's new for admins</h1>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">Since the last one of these emails. Each line opens its list on the hub.</p>
      <ul style="list-style:disc;padding-left:20px;margin:0;font-size:15px;">${items}</ul>
      ${notes.map((n) => `<p style="margin:20px 0 0;font-size:15px;line-height:1.5;">${escapeHtml(n)}</p>`).join("")}
      <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;">
        You receive this because you are an admin of ${escapeHtml(p.hub_name)}. It counts only what arrived since the last
        one, and nothing is sent when nothing is new. Whether it is sent at all is under Hub settings → Plugins.
      </p>
    </div>
  `;
  const text = [
    `${p.hub_name}: what's new for admins (since the last one of these emails)`,
    "",
    ...lines.flatMap((l) => [`- ${digestLineText(l)}`, `  ${l.url}`]),
    ...notes.flatMap((n) => ["", n]),
    "",
    `You receive this because you are an admin of ${p.hub_name}. It counts only what arrived since the last one, and nothing is sent when nothing is new.`,
  ].join("\n");
  return { subject, html, text };
}

// --- Dispatch -----------------------------------------------------------------

export interface AdminDigestRunResult {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Nothing new: no email. */
  empty: boolean;
  /** Another run had already covered this window. */
  already_covered?: boolean;
  since: string;
  until: string;
  /** New and waiting per category, for the run log and tests. */
  counts: Record<string, { new: number; waiting: number | null; flagged: number }>;
}

/** Keyless local development "sends" by logging; that counts as delivered for the mark. */
const KEYLESS = "RESEND_API_KEY is not configured";

export async function runAdminDigest(recipients: string[], now: Date = new Date()): Promise<AdminDigestRunResult> {
  const until = now.toISOString();
  const previous = await readMark();
  const since = previous ?? new Date(now.getTime() - FIRST_WINDOW_MS).toISOString();
  const base = { total: recipients.length, sent: 0, skipped: 0, failed: 0, since, until, counts: {} };

  if (previous !== null && Date.parse(previous) >= now.getTime()) {
    return { ...base, skipped: recipients.length, empty: true, already_covered: true };
  }
  if (!(await moveMark(previous, until))) {
    return { ...base, skipped: recipients.length, empty: true, already_covered: true };
  }

  let payload: AdminDigestPayload;
  try {
    payload = await buildAdminDigest(since, until);
  } catch (err) {
    await releaseMark(until, previous);
    throw err;
  }
  const counts = Object.fromEntries(
    payload.lines.map((l) => [l.id, { new: l.new_count, waiting: l.waiting, flagged: l.flagged }]),
  );

  if (payload.empty) {
    console.log(`[admin-digest] Nothing new since ${since} — no email (${recipients.length} recipient(s)).`);
    return { ...base, skipped: recipients.length, empty: true, counts };
  }
  if (recipients.length === 0) {
    console.warn("[admin-digest] No admins to send to; the window stays open for the next run.");
    await releaseMark(until, previous);
    return { ...base, empty: false, counts };
  }

  const { subject, html, text } = renderAdminDigestEmail(payload);
  let sent = 0;
  let failed = 0;
  let delivered = 0;
  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html, text });
    if (result.sent) {
      sent += 1;
      delivered += 1;
      console.log(`[admin-digest] Sent to ${to} (resend id: ${result.id ?? "?"})`);
    } else if (result.error === KEYLESS) {
      delivered += 1;
      console.log(`---- [admin-digest] RESEND_API_KEY unset — logging email ----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---- end ----`);
    } else {
      failed += 1;
      console.warn(`[admin-digest] Send failed for ${to}: ${result.error ?? result.held_back_reason ?? "unknown"}`);
    }
  }
  // Nobody got it: the next run covers this window again rather than losing it.
  if (delivered === 0) await releaseMark(until, previous);
  return { ...base, sent, failed, empty: false, counts };
}
