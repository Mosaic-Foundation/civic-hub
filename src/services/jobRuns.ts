// Scheduled-job run log (job_runs, 20260929000000).
//
// Every hub job run that did something leaves one row: when it ran, what it
// produced in one line, and why it is flagged or failed. Two readers:
//
//   - the admin's plugin page, one "last run" line per job (latestJobRuns);
//   - the admin digest, every failed or flagged run since the last digest
//     (jobProblemsSince).
//
// Written by the job runner (src/jobs/runJob.ts), inside the hub's scope, via
// forHub(). Recording is best-effort: a run log that cannot be written must
// never turn a good run into a failed one, so failures here are logged and
// swallowed. What each job's outcome means is decided in src/jobs/describe.ts.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import type { JobRunStatus, JobRunDescription } from "../jobs/describe.js";

/** Rows kept per hub and job; older ones are pruned on write. */
export const JOB_RUNS_KEPT = 60;

export interface JobRunRecord {
  job_id: string;
  started_at: string;
  finished_at: string;
  status: JobRunStatus;
  summary: string;
  problems: string[];
}

interface JobRunRow extends JobRunRecord {
  id: string;
  details: unknown;
}

const COLUMNS = "id, job_id, started_at, finished_at, status, summary, problems";

export async function recordJobRun(
  jobId: string,
  startedAt: Date,
  run: JobRunDescription,
  details: unknown,
): Promise<void> {
  try {
    const db = forHub(currentHubId());
    await db.from("job_runs").insert({
      job_id: jobId,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      status: run.status,
      summary: run.summary,
      problems: run.problems,
      details: details ?? null,
    });
    // Prune: everything older than the newest JOB_RUNS_KEPT for this job.
    const keep = await db
      .from("job_runs")
      .select<{ started_at: string }>("started_at")
      .eq("job_id", jobId)
      .order("started_at", { ascending: false })
      .limit(JOB_RUNS_KEPT);
    if (keep.length === JOB_RUNS_KEPT) {
      const oldestKept = keep[keep.length - 1].started_at;
      await db.from("job_runs").delete().eq("job_id", jobId).lt("started_at", oldestKept);
    }
  } catch (err) {
    console.warn(
      `[job-runs] could not record ${jobId} for hub=${currentHubId()}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * The newest recorded run of each job, plus the newest run that had a
 * problem when it is not the newest run — so a failure is still visible the
 * day after a clean run replaced it as "last".
 */
export async function latestJobRuns(): Promise<
  Record<string, { last: JobRunRecord; last_problem: JobRunRecord | null }>
> {
  const rows = await forHub(currentHubId())
    .from("job_runs")
    .select<JobRunRow>(COLUMNS)
    .order("started_at", { ascending: false })
    .limit(500);
  const out: Record<string, { last: JobRunRecord; last_problem: JobRunRecord | null }> = {};
  for (const r of rows) {
    const rec = toRecord(r);
    const entry = out[rec.job_id];
    if (!entry) {
      out[rec.job_id] = { last: rec, last_problem: rec.status === "ok" ? null : rec };
    } else if (!entry.last_problem && rec.status !== "ok") {
      entry.last_problem = rec;
    }
  }
  return out;
}

/** Every failed or flagged run that finished at or after `sinceIso`, newest first. */
export async function jobProblemsSince(sinceIso: string): Promise<JobRunRecord[]> {
  const rows = await forHub(currentHubId())
    .from("job_runs")
    .select<JobRunRow>(COLUMNS)
    .in("status", ["failed", "flagged"])
    .gte("finished_at", sinceIso)
    .order("finished_at", { ascending: false })
    .limit(100);
  return rows.map(toRecord);
}

function toRecord(r: JobRunRow): JobRunRecord {
  return {
    job_id: r.job_id,
    started_at: r.started_at,
    finished_at: r.finished_at,
    status: r.status,
    summary: r.summary ?? "",
    problems: Array.isArray(r.problems) ? r.problems.map(String) : [],
  };
}
