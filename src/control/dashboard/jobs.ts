// Dashboard section "Jobs and backups": one row per scheduled job, and the backup.
//
// A job's last run is its last scheduled run in job_last_run (every run,
// including the ones that did nothing; the per-hub job_runs keeps only runs
// that did something). The next run and "late" come from its cron schedule
// with the heartbeats' grace (src/jobs/schedule.ts), so a row is late exactly
// when its Healthchecks.io check would go down. An empty table (a deployment
// whose jobs have not run since the migration) shows every job as never run,
// and late once a due time and its grace have passed.
//
// The backup runs on GitHub, not here: its last dump comes from the
// Healthchecks.io check its workflow pings, when HEALTHCHECKS_READ_KEY is set.

import { JOBS, isPlatformJob } from "../../jobs/registry.js";
import { isLate, nextRun } from "../../jobs/schedule.js";
import { readJobLastRuns, type JobLastRun } from "../../db/jobLastRun.js";
import { backupStatus, type BackupStatus, type OutsideResult } from "./outside.js";
import type { SectionContext } from "./registry.js";

export interface JobRow {
  id: string;
  description: string;
  schedule: string;
  scope: "hub" | "platform";
  last: Pick<JobLastRun, "started_at" | "finished_at" | "status" | "duration_ms" | "hubs_run" | "hubs_failed" | "error"> | null;
  next_run_at: string | null;
  late: boolean;
  /** Late or failed: the row stands out. */
  attention: boolean;
}

export interface JobsSection {
  jobs: JobRow[];
  backup: OutsideResult<BackupStatus>;
}

export function jobRows(lastRuns: Record<string, JobLastRun>, now: Date): JobRow[] {
  return JOBS.map((job) => {
    const last = lastRuns[job.id] ?? null;
    const late = isLate(job.schedule, last ? new Date(last.started_at) : null, now);
    return {
      id: job.id,
      description: job.description,
      schedule: job.schedule,
      scope: isPlatformJob(job) ? "platform" : "hub",
      last: last && {
        started_at: last.started_at,
        finished_at: last.finished_at,
        status: last.status,
        duration_ms: last.duration_ms,
        hubs_run: last.hubs_run,
        hubs_failed: last.hubs_failed,
        error: last.error,
      },
      next_run_at: nextRun(job.schedule, now)?.toISOString() ?? null,
      late,
      attention: late || last?.status === "failed",
    };
  });
}

export async function loadJobs(ctx: SectionContext): Promise<JobsSection> {
  const [lastRuns, backup] = await Promise.all([readJobLastRuns(), backupStatus(ctx.fresh)]);
  return { jobs: jobRows(lastRuns, ctx.now), backup };
}
