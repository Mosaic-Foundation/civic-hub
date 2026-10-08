// What a job run means to an admin: its status, one line on what it produced,
// and every problem worth their attention. Keyed on the job ids in
// src/jobs/registry.ts; read by src/jobs/runJob.ts, which records the result
// in job_runs (src/services/jobRuns.ts).
//
// Pure functions over the runner's own outcome body, so each job keeps
// reporting in its own shape and this file is the one place that reads them.
// Returning null means "nothing happened worth a row" — the digest's 23
// not-the-send-hour runs a day, a plugin with no source configured, an hourly
// vote-close that closed nothing.

import type { JobOutcome } from "./types.js";
import { currentHub } from "../config/hubContext.js";
import { getSettingSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import { hubKindOf, participantNoun } from "../shared/hubKind.js";
import { RECORD_GRACE_DAYS, SOURCE_QUIET_DAYS } from "../modules/civic.meeting_summary/readiness.js";

export type JobRunStatus = "ok" | "flagged" | "failed";

export interface JobRunDescription {
  status: JobRunStatus;
  /** One line, admin-facing. */
  summary: string;
  /** One admin-facing line per problem; empty when status is "ok". */
  problems: string[];
}

type Body = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const arr = <T = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "40 neighbors" in the hub's own word for its people; "people" when no hub is in scope. */
const people = (n: number): string =>
  currentHub()
    ? `${n} ${participantNoun(hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)), n, getSettingSync(KEYS.COPY_RESIDENT_NOUN))}`
    : `${n} ${n === 1 ? "person" : "people"}`;

function status(problemsFailed: string[], problemsFlagged: string[]): JobRunStatus {
  if (problemsFailed.length > 0) return "failed";
  if (problemsFlagged.length > 0) return "flagged";
  return "ok";
}

/** Anything a runner reports as an error, whatever the job. */
function genericFailure(outcome: JobOutcome): JobRunDescription | null {
  const error = typeof outcome.body.error === "string" ? outcome.body.error : null;
  if (outcome.status >= 500 || error) {
    return {
      status: "failed",
      summary: "The run did not complete",
      problems: [error ?? `The run ended with status ${outcome.status}`],
    };
  }
  return null;
}

function describeMeetingSummary(b: Body): JobRunDescription {
  const failed: string[] = [];
  const flagged: string[] = [];

  for (const f of arr<{ source_id?: string; error?: string }>(b.failures)) {
    failed.push(`Could not summarize ${f.source_id ?? "a meeting"}: ${f.error ?? "unknown error"}`);
  }
  for (const f of arr<{ meeting_date?: string; meeting_title?: string; message?: string }>(b.flagged)) {
    flagged.push(`${f.meeting_date} ${f.meeting_title}: ${f.message}. Held for review.`);
  }
  const waiting = arr<{ meeting_date?: string; meeting_title?: string; reason?: string; days_since_meeting?: number }>(
    b.waiting,
  );
  for (const w of waiting) {
    if (num(w.days_since_meeting) > RECORD_GRACE_DAYS) {
      flagged.push(
        `${w.meeting_date} ${w.meeting_title} has waited ${w.days_since_meeting} days: ${w.reason}`,
      );
    }
  }
  if (num(b.stale_summaries) > 0) {
    flagged.push(
      `${plural(num(b.stale_summaries), "summary was", "summaries were")} written before the meeting took place and not yet replaced.`,
    );
  }
  // Any process type, not only summaries (review M4): each one named, with
  // what is wrong, so the admin can open it. Rows written before 2026-10-07
  // stored only a count.
  const broken = arr<{ title?: string; process_type?: string; reason?: string }>(b.broken_links);
  if (broken.length > 0) {
    for (const item of broken) failed.push(brokenLinkProblem(item));
  } else if (num(b.broken_links) > 0) {
    failed.push(
      `${plural(num(b.broken_links), "item is", "items are")} announced on the feed as published, but ${num(b.broken_links) === 1 ? "its page is" : "their pages are"} not public.`,
    );
  }
  // A quiet source (Adam, 2026-10-07): nothing new is fine, but no new
  // meeting in SOURCE_QUIET_DAYS probably means the source stopped working.
  // Only on rows that carry the field (written since then).
  if ("days_since_newest_meeting" in b) {
    const newest = typeof b.newest_meeting_date === "string" ? b.newest_meeting_date : null;
    if (newest === null) {
      flagged.push("The meeting source has not listed any meetings yet. Check that it is set up correctly.");
    } else if (num(b.days_since_newest_meeting) > SOURCE_QUIET_DAYS) {
      flagged.push(
        `No new meetings found since ${newest} (${num(b.days_since_newest_meeting)} days). Check that the meeting source still works.`,
      );
    }
  }
  if (num(b.pending_revisions_overdue) > 0) {
    flagged.push(
      `${plural(num(b.pending_revisions_overdue), "revision has", "revisions have")} waited more than two weeks for review.`,
    );
  }

  // An empty listing is "nothing new", not a failure (review M7). A source
  // that cannot be read throws in discovery, and that run fails on its error.
  const parts =
    num(b.discovered) === 0 && num(b.created) === 0
      ? ["Nothing new: the meeting source listed no meetings"]
      : [plural(num(b.created), "summary written", "summaries written")];
  if (num(b.upgraded) > 0) parts.push(`${num(b.upgraded)} updated`);
  if (waiting.length > 0) parts.push(`${waiting.length} waiting for a recording or minutes`);
  if (arr(b.failures).length > 0) parts.push(`${arr(b.failures).length} failed`);
  return { status: status(failed, flagged), summary: parts.join(", "), problems: [...failed, ...flagged] };
}

/** "civic.meeting_summary" → "meeting summary". */
function typeLabel(type: string | undefined): string {
  return (type ?? "item").replace(/^civic\./, "").replace(/_/g, " ");
}

/** One broken feed item, in words an admin can act on. */
export function brokenLinkProblem(item: { title?: string; process_type?: string; reason?: string }): string {
  const what = item.title ? `"${item.title}" (${typeLabel(item.process_type)})` : `A ${typeLabel(item.process_type)}`;
  return `${what} is announced on the feed as published, but ${item.reason ?? "its page is not public"}.`;
}

function describeNewsSync(b: Body): JobRunDescription {
  const failed = num(b.failed) > 0 ? [`${plural(num(b.failed), "news post", "news posts")} could not be imported.`] : [];
  const created = num(b.created);
  const summary =
    num(b.discovered) === 0
      ? "The news source had no posts"
      : `${plural(created, "new announcement", "new announcements")} from ${plural(num(b.discovered), "post", "posts")}`;
  return { status: status(failed, []), summary, problems: failed };
}

function describeDigest(b: Body): JobRunDescription {
  const failed = num(b.failed_count) > 0 ? [`The digest could not be sent to ${people(num(b.failed_count))}.`] : [];
  // Held back by the hub's mode is a decision, not a failure (review #36):
  // it goes in the summary, never in the problems.
  const held = num(b.held_back_count);
  const reason = typeof b.held_back_reason === "string" ? b.held_back_reason : "of this hub's mode";
  let summary = `Sent to ${people(num(b.sent_count))}`;
  if (held > 0) summary += `; held back from ${held} because ${reason}`;
  return { status: status(failed, []), summary, problems: failed };
}

function describeAdminDigest(b: Body): JobRunDescription {
  const failed = num(b.failed) > 0 ? [`The admin digest could not be sent to ${plural(num(b.failed), "admin", "admins")}.`] : [];
  const summary = b.empty === true ? "Nothing to report; no email sent" : `Sent to ${plural(num(b.sent), "admin", "admins")}`;
  return { status: status(failed, []), summary, problems: failed };
}

function describeVoteClose(b: Body): JobRunDescription | null {
  const closed = arr(b.closed).length;
  const failedRows = arr<{ id?: string; error?: string }>(b.failed);
  if (closed === 0 && failedRows.length === 0) return null;
  const failed = failedRows.map((f) => `Could not close ${f.id ?? "a vote"}: ${f.error ?? "unknown error"}`);
  return { status: status(failed, []), summary: `${plural(closed, "vote", "votes")} closed`, problems: failed };
}

/**
 * The sample refresh (2026-10-07): a row only when it replaced or added
 * something. A hub that is not in demo, or whose samples are all current,
 * records nothing.
 */
function describeSampleRefresh(b: Body): JobRunDescription | null {
  if (typeof b.skipped === "string") return null;
  const replaced = arr<{ key?: string }>(b.replaced).length;
  const added = arr(b.added).length;
  const minutes = arr(b.minutes_added).length;
  if (replaced + added + minutes === 0) return null;
  const parts = [
    replaced > 0 ? `${plural(replaced, "sample", "samples")} replaced with a fresh copy` : null,
    added > 0 ? `${plural(added, "missing sample", "missing samples")} added` : null,
    minutes > 0 ? `minutes added to ${plural(minutes, "sample meeting summary", "sample meeting summaries")}` : null,
  ].filter(Boolean);
  const summary = parts.join("; ");
  return { status: "ok", summary: summary.charAt(0).toUpperCase() + summary.slice(1), problems: [] };
}

const DESCRIBERS: Readonly<Record<string, (b: Body) => JobRunDescription | null>> = {
  meeting_summary: describeMeetingSummary,
  news_sync: describeNewsSync,
  digest: describeDigest,
  admin_digest: describeAdminDigest,
  vote_close: describeVoteClose,
  sample_refresh: describeSampleRefresh,
};

/**
 * What one hub's run of `jobId` means, or null when there is nothing to
 * record. A thrown run (no outcome) is always a failure.
 */
export function describeJobRun(
  jobId: string,
  outcome: JobOutcome | null,
  thrown?: string,
): JobRunDescription | null {
  if (thrown !== undefined) {
    return { status: "failed", summary: "The run did not complete", problems: [thrown] };
  }
  if (!outcome) return null;
  if (outcome.body.skipped === true) return null;
  const failure = genericFailure(outcome);
  if (failure) return failure;
  const describe = DESCRIBERS[jobId];
  if (!describe) {
    return { status: "ok", summary: "Completed", problems: [] };
  }
  return describe(outcome.body);
}
