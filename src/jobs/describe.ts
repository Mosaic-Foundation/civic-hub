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
import { RECORD_GRACE_DAYS } from "../modules/civic.meeting_summary/readiness.js";

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

  if (num(b.discovered) === 0) {
    failed.push(
      "The meeting source listed no meetings. It has probably changed shape and can no longer be read.",
    );
  }
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
  if (num(b.broken_links) > 0) {
    failed.push(`${plural(num(b.broken_links), "published summary link", "published summary links")} no longer open.`);
  }
  if (num(b.pending_revisions_overdue) > 0) {
    flagged.push(
      `${plural(num(b.pending_revisions_overdue), "revision has", "revisions have")} waited more than two weeks for review.`,
    );
  }

  const parts = [
    plural(num(b.created), "summary written", "summaries written"),
  ];
  if (num(b.upgraded) > 0) parts.push(`${num(b.upgraded)} updated`);
  if (waiting.length > 0) parts.push(`${waiting.length} waiting for a recording or minutes`);
  if (arr(b.failures).length > 0) parts.push(`${arr(b.failures).length} failed`);
  return { status: status(failed, flagged), summary: parts.join(", "), problems: [...failed, ...flagged] };
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
  const failed = num(b.failed_count) > 0 ? [`The digest could not be sent to ${plural(num(b.failed_count), "resident", "residents")}.`] : [];
  return {
    status: status(failed, []),
    summary: `Sent to ${plural(num(b.sent_count), "resident", "residents")}`,
    problems: failed,
  };
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

const DESCRIBERS: Readonly<Record<string, (b: Body) => JobRunDescription | null>> = {
  meeting_summary: describeMeetingSummary,
  news_sync: describeNewsSync,
  digest: describeDigest,
  admin_digest: describeAdminDigest,
  vote_close: describeVoteClose,
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
