// The /internal/*/run routes, mounted from the job registry.
//
// Thin by design: check the cron credential, parse `?hub=` and `?force=`,
// hand off to runScheduledJob (src/jobs/scheduled.ts, which scripts/run-job.ts
// calls too), write its report. HUB_CRON_ENABLED is
// checked before any of this by cronKillSwitch on the /internal mount
// (src/config/cron.ts), so a job added to the registry is covered by it
// without anyone remembering to.

import { Router } from "express";
import { UnauthorizedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { JOBS, isPlatformJob, type JobSpec } from "../jobs/registry.js";
import { runScheduledJob } from "../jobs/scheduled.js";
import { isCronAuthorized } from "../jobs/cronAuth.js";
import { requestedHub } from "../services/cronHubs.js";

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
    // A run for every hub is the scheduled one (heartbeat, job_last_run);
    // one hub (?hub=) is someone checking by hand. sendError() (route())
    // flushes the error report of a run that threw.
    const answer = await runScheduledJob(job, { force, onlyHub });
    res.status(answer.status).json(answer.body);
  });
}

export const jobRouter = Router();
for (const job of JOBS) {
  for (const path of [job.path, ...(job.deprecatedPaths ?? [])]) {
    jobRouter.get(path, handlerFor(job, path));
  }
}
