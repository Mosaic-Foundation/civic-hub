// The /internal/*/run routes, mounted from the job registry.
//
// Thin by design: check the cron credential, parse `?hub=` and `?force=`,
// hand off to runJobAcrossHubs, write its report. HUB_CRON_ENABLED is
// checked before any of this by cronKillSwitch on the /internal mount
// (src/config/cron.ts), so a job added to the registry is covered by it
// without anyone remembering to.

import { Router } from "express";
import { NotFoundError, UnauthorizedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { JOBS, isPlatformJob, type JobSpec } from "../jobs/registry.js";
import { JOB_RUNNERS, PLATFORM_JOB_RUNNERS } from "../jobs/runners.js";
import { runJobAcrossHubs } from "../jobs/runJob.js";
import { isCronAuthorized } from "../jobs/cronAuth.js";
import { requestedHub } from "../services/cronHubs.js";
import { pingHeartbeat } from "../utils/heartbeat.js";
import { recordJobLastRun } from "../db/jobLastRun.js";
import { flushErrors } from "../utils/errorTracking.js";

function handlerFor(job: JobSpec, calledAs: string) {
  return route(async (req, res) => {
    if (!isCronAuthorized(req.headers.authorization)) {
      throw new UnauthorizedError("Invalid or missing cron credential", "invalid_cron_credential");
    }
    if (calledAs !== job.path) {
      console.warn(
        `[jobs] ${job.id} called on the deprecated path /internal${calledAs}; schedule /internal${job.path} instead`,
      );
    }
    const force = req.query.force === "true" || req.query.force === "1";
    const onlyHub = isPlatformJob(job) ? null : requestedHub(req.query);
    if (onlyHub === undefined) {
      throw new ValidationError("hub must be a hub slug", "invalid_hub");
    }
    // A run for every hub is the scheduled one, and pings its heartbeat:
    // success, or /fail when any hub failed or the run threw. A run for one
    // hub (?hub=) is someone checking by hand, and does not. The ping and any
    // error report go out BEFORE the response: a serverless function may be
    // frozen once its response is sent.
    // The same run, and only it, is recorded as the job's last run
    // (job_last_run), even when it did nothing: the console's Dashboard
    // tells a late job from it.
    const beats = onlyHub === null;
    const started = new Date();
    let answer: { status: number; body: unknown };
    try {
      answer = await runOnce(job, force, onlyHub);
    } catch (err) {
      // sendError() (route()) flushes the error report on its way out.
      if (beats) {
        const error = err instanceof Error ? err.message : String(err);
        await Promise.all([
          pingHeartbeat(job.id, false),
          recordJobLastRun(job.id, started, { ok: false, hubsRun: 0, hubsFailed: 0, error }),
        ]);
      }
      throw err;
    }
    await Promise.all([
      beats ? pingHeartbeat(job.id, answer.status < 500) : undefined,
      beats ? recordJobLastRun(job.id, started, { ok: answer.status < 500, ...hubCounts(answer.body) }) : undefined,
      flushErrors(),
    ]);
    res.status(answer.status).json(answer.body);
  });
}

/** How many hubs a run looked at, and how many of them failed. */
function hubCounts(body: unknown): { hubsRun: number; hubsFailed: number } {
  const hubs = (body as { hubs?: Record<string, Record<string, unknown>> } | null)?.hubs;
  if (!hubs) return { hubsRun: 0, hubsFailed: 0 };
  const results = Object.values(hubs);
  return { hubsRun: results.length, hubsFailed: results.filter((r) => r && "error" in r).length };
}

async function runOnce(
  job: JobSpec,
  force: boolean,
  onlyHub: string | null,
): Promise<{ status: number; body: unknown }> {
  if (isPlatformJob(job)) {
    const run = PLATFORM_JOB_RUNNERS[job.id];
    if (!run) throw new Error(`job "${job.id}" has no runner`);
    const outcome = await run({ now: new Date(), force });
    return { status: outcome.status, body: { job: job.id, platform: outcome.body } };
  }
  const runner = JOB_RUNNERS[job.id];
  if (!runner) throw new Error(`job "${job.id}" has no runner`);
  const report = await runJobAcrossHubs(job, runner, { now: new Date(), force, onlyHub });
  if ("error" in report) throw new NotFoundError(report.error, "hub_not_found");
  return { status: report.status, body: { job: job.id, hubs: report.hubs } };
}

export const jobRouter = Router();
for (const job of JOBS) {
  for (const path of [job.path, ...(job.deprecatedPaths ?? [])]) {
    jobRouter.get(path, handlerFor(job, path));
  }
}
