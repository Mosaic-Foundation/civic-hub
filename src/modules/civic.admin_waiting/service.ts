// civic.admin_waiting: what is new for a space's admins in a window, and
// what is waiting beside it (kernel step 4, 2026-11-19; it was the counting
// half of civic.admin_digest, whose email is now the Admin digest plugin,
// features/admin_digest). The kernel keeps it because the queues are the
// kernel's and every plugin's: reviews, the packages' publication queues,
// the features' queues (FeatureServer.queues), edits, the waitlist and job
// problems, and the features' own notes (FeatureServer.digestLines). A plugin
// reads it through the SDK (`adminWaiting.window(since, until)`).
//
// THE RULE (leaving-demo slice, 2026-10-15): a window counts only what is new
// in it, and an item falls in exactly one window: every category is counted
// by a time that never changes once written (a review's latest submission
// turn, a brief's or meeting summary's creation, a feature queue item's, a
// waitlist signup's, an edit event's, a job run's finish). The caller keeps
// where its last window ended (the Admin digest's mark).
//
// One line per category, new and waiting, each a link to that queue.

import { editEvents, latestSubmissions, waitlistRows } from "./store.js";
import { getAllProcesses, getSampleProcessIds } from "../../services/processService.js";
import { getManifest, getProcessHandler, publicationOf, typesPublishedThrough } from "../../processes/registry.js";
import { listReviews } from "../civic.review/index.js";

import { uiBaseUrl } from "../../utils/baseUrl.js";
import { getSettingSync, hubDisplayNameSync, hubModeSync, isPluginEnabledSync } from "../../services/hubSettings.js";
import { KEYS, asEmailList } from "../../models/hubSettings.js";
import { isSubstantiveEdit } from "../../services/processEdits.js";
import { jobProblemsSince, latestJobRuns, type JobRunRecord } from "../../services/jobRuns.js";
import { hubTimeZone } from "../../services/hubTimeZone.js";
import { jobById } from "../../jobs/registry.js";
import { problemQueue } from "../../jobs/describe.js";
import { jobPath, type PluginId } from "../../shared/adminAnchors.js";
import type { AdminWindow, DigestDetail, DigestLine } from "./models.js";
import { featureDigestLines, featureQueues } from "../../plugins/features.js";

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
        // The type says whether it wants a closer look (its handler's flaggedForReview, kernel step 3).
        if (getProcessHandler(type)?.flaggedForReview?.(p)) summaries.flagged += 1;
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

/** A line per feature queue whose feature is on (Feedback's), where Feedback's line stood. */
async function featureQueueLines(since: string, until: string, ui: string): Promise<DigestLine[]> {
  const lines: DigestLine[] = [];
  for (const { queue, on } of featureQueues()) {
    if (!on()) continue;
    lines.push({
      id: queue.name,
      noun: queue.noun,
      new_count: await queue.count(since, until),
      waiting: null,
      flagged: 0,
      url: `${ui}${queue.path}`,
    });
  }
  return lines;
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

/** Problems listed one by one in the email; the rest are counted. */
export const JOB_PROBLEMS_LISTED = 5;

/**
 * Where one problem is dealt with: the review queue it asks for (a meeting
 * summary revision), else where its job's runs are shown and what the job
 * depends on is set.
 */
export function problemUrl(ui: string, jobId: string, problem: string): string {
  if (problemQueue(jobId, problem) === "meeting_summaries") {
    // A revision that has waited opens on the list's "Revision waiting" tab.
    const tab = /revisions? (has|have) waited/.test(problem) ? "?show=revision" : "";
    return `${ui}/admin/meeting-summaries${tab}`;
  }
  const job = jobById(jobId);
  const plugin = job && "plugin" in job ? ((job.plugin ?? null) as PluginId | null) : null;
  return `${ui}${jobPath(plugin)}`;
}

/** "Nov 10, 9:05 PM EST" in the hub's own clock. */
function runTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
  } catch {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  }
}

/**
 * One problem of a run, in words an admin can act on: which job, when, what
 * went wrong, and whether the job has run cleanly since. Pure.
 */
export function jobProblemText(r: JobRunRecord, problem: string, laterOk: JobRunRecord | null, timeZone: string): string {
  const name = JOB_NAMES[r.job_id] ?? r.job_id;
  const what = r.status === "failed" ? "failed" : "needs a check";
  const since = laterOk ? ` It has run without a problem since (${runTime(laterOk.finished_at, timeZone)}).` : "";
  return `${name}, ${runTime(r.finished_at, timeZone)}: ${what}.${problem.trim() ? ` ${problem.trim()}` : ""}${since}`;
}

/** Each problem a run recorded; a run that recorded none is one, by its summary. */
function problemsOf(r: JobRunRecord): string[] {
  return r.problems.length > 0 ? r.problems : [r.summary];
}

async function jobsLine(since: string, until: string, ui: string): Promise<DigestLine> {
  const base = {
    id: "job_problems" as const,
    noun: { one: "scheduled job problem", many: "scheduled job problems" },
    waiting: null,
    flagged: 0,
  };
  let runs: JobRunRecord[];
  try {
    runs = (await jobProblemsSince(since)).filter(
      (r) => (r.status === "failed" || r.status === "flagged") && within(r.finished_at, since, until),
    );
  } catch (err) {
    // Not being able to read the log is itself worth an admin's look.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[admin-waiting] Job run log unavailable: ${message}`);
    const url = `${ui}${jobPath(null)}`;
    return { ...base, new_count: 1, url, details: [{ text: `The hub's job run log could not be read: ${message}`, url }] };
  }
  if (runs.length === 0) return { ...base, new_count: 0, url: `${ui}${jobPath(null)}` };

  // Whether each job has run cleanly since its problem. Best-effort: without
  // it the email still names the problem.
  let latest: Awaited<ReturnType<typeof latestJobRuns>> = {};
  try {
    latest = await latestJobRuns();
  } catch {
    /* the problems alone */
  }
  const zone = hubTimeZone();
  // One item per problem, so the count and the list agree.
  const all: DigestDetail[] = runs.flatMap((r) => {
    const last = latest[r.job_id]?.last ?? null;
    const laterOk = last && last.status === "ok" && Date.parse(last.finished_at) > Date.parse(r.finished_at) ? last : null;
    return problemsOf(r).map((problem) => ({
      text: jobProblemText(r, problem, laterOk, zone),
      url: problemUrl(ui, r.job_id, problem),
    }));
  });
  const details = all.slice(0, JOB_PROBLEMS_LISTED);
  if (all.length > JOB_PROBLEMS_LISTED) {
    const more = all.length - JOB_PROBLEMS_LISTED;
    details.push({ text: `${more} more ${more === 1 ? "problem" : "problems"}; every job's runs are on the Plugins page.`, url: `${ui}/admin/settings/plugins` });
  }
  // The line's own link: the one place, when every problem is in one place.
  const urls = new Set(details.map((d) => d.url));
  const url = urls.size === 1 ? details[0].url : `${ui}/admin/settings/plugins`;
  return { ...base, new_count: all.length, url, details };
}

/**
 * Count every category for the window (since, until]. A category whose plugin
 * the hub switched off is left out: its queue's page is gone. Process reviews,
 * edits, the waitlist and job problems belong to no plugin.
 */
export async function adminWindow(since: string, until: string): Promise<AdminWindow> {
  const ui = uiBaseUrl();
  // Sample content (Phase 7) never asks an admin for anything.
  const sampleIds = await getSampleProcessIds();
  const lines: DigestLine[] = [];
  lines.push(await jobsLine(since, until, ui));
  lines.push(await reviewsLine(since, until, sampleIds, ui));
  lines.push(...(await briefAndSummaryLines(since, until, ui)));
  lines.push(...(await featureQueueLines(since, until, ui)));
  lines.push(await editsLine(since, until, sampleIds, ui));
  lines.push(await waitlistLine(since, until, ui));
  const new_total = lines.reduce((sum, l) => sum + l.new_count, 0);
  const notes = await featureNotes(new Date(until));
  return { hub_name: hubDisplayNameSync(), since, until, lines, new_total, notes, empty: new_total === 0 && notes.length === 0 };
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
      console.warn(`[admin-waiting] the ${feature} line failed: ${(err as Error).message}`);
    }
  }
  return out;
}

