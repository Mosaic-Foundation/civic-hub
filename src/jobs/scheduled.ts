// One run of a scheduled job, however it was started: Vercel Cron through the
// /internal/*/run route (src/routes/jobRoutes.ts), or a plain cron on any
// host through scripts/run-job.ts (ADR-012). Both call runScheduledJob, so a
// run is recorded the same way from both.
//
// A run for every hub (onlyHub null) is the scheduled one: it pings the job's
// heartbeat (success, or failed when any hub failed or the run threw) and is
// recorded as the job's last run (job_last_run), even when it did nothing,
// so the console's Dashboard tells a late job from an idle one. A run for one
// hub is someone checking by hand, and does neither; each hub's own result
// still goes to job_runs (src/jobs/runJob.ts). The ping and any error report
// go out before this returns: a serverless function may be frozen once its
// response is sent.

import { NotFoundError } from "../errors/index.js";
import { isPlatformJob, type JobSpec } from "./registry.js";
import { jobRunners, PLATFORM_JOB_RUNNERS } from "./runners.js";
import { runJobAcrossHubs } from "./runJob.js";
import { adapters } from "../adapters/index.js";
import { recordJobLastRun } from "../db/jobLastRun.js";
import { flushErrors } from "../utils/errorTracking.js";

export interface ScheduledRun {
  /** HTTP-style: 500 when any hub failed. */
  status: number;
  /** `{ job, hubs: { <hub>: outcome } }`, or `{ job, platform: outcome }` for a platform job. */
  body: unknown;
}

/**
 * Run `job` for every active hub (onlyHub null) or one, and record it as
 * above. Throws what the run threw (after pinging and recording), and
 * NotFoundError for an unknown hub.
 */
export async function runScheduledJob(
  job: JobSpec,
  opts: { force: boolean; onlyHub: string | null; now?: Date },
): Promise<ScheduledRun> {
  const beats = opts.onlyHub === null;
  const started = new Date();
  let answer: ScheduledRun;
  try {
    answer = await runOnce(job, opts.force, opts.onlyHub, opts.now ?? new Date());
  } catch (err) {
    if (beats) {
      const error = err instanceof Error ? err.message : String(err);
      await Promise.all([
        adapters().heartbeat.ping(job.id, false),
        recordJobLastRun(job.id, started, { ok: false, hubsRun: 0, hubsFailed: 0, error }),
      ]);
    }
    throw err;
  }
  await Promise.all([
    beats ? adapters().heartbeat.ping(job.id, answer.status < 500) : undefined,
    beats ? recordJobLastRun(job.id, started, { ok: answer.status < 500, ...hubCounts(answer.body) }) : undefined,
    flushErrors(),
  ]);
  return answer;
}

/** How many hubs a run looked at, and how many of them failed. */
function hubCounts(body: unknown): { hubsRun: number; hubsFailed: number } {
  const hubs = (body as { hubs?: Record<string, Record<string, unknown>> } | null)?.hubs;
  if (!hubs) return { hubsRun: 0, hubsFailed: 0 };
  const results = Object.values(hubs);
  return { hubsRun: results.length, hubsFailed: results.filter((r) => r && "error" in r).length };
}

async function runOnce(job: JobSpec, force: boolean, onlyHub: string | null, now: Date): Promise<ScheduledRun> {
  if (isPlatformJob(job)) {
    const run = PLATFORM_JOB_RUNNERS[job.id];
    if (!run) throw new Error(`job "${job.id}" has no runner`);
    const outcome = await run({ now, force });
    return { status: outcome.status, body: { job: job.id, platform: outcome.body } };
  }
  const runner = jobRunners()[job.id];
  if (!runner) throw new Error(`job "${job.id}" has no runner`);
  const report = await runJobAcrossHubs(job, runner, { now, force, onlyHub });
  if ("error" in report) throw new NotFoundError(report.error, "hub_not_found");
  return { status: report.status, body: { job: job.id, hubs: report.hubs } };
}
