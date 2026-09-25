// The /internal/*/run routes, mounted from the job registry.
//
// Thin by design: check the cron credential, parse `?hub=` and `?force=`,
// hand off to runJobAcrossHubs, write its report. HUB_CRON_ENABLED is
// checked before any of this by cronKillSwitch on the /internal mount
// (src/config/cron.ts), so a job added to the registry is covered by it
// without anyone remembering to.

import { Router, type Request, type Response } from "express";
import { JOBS, type JobSpec } from "../jobs/registry.js";
import { JOB_RUNNERS } from "../jobs/runners.js";
import { runJobAcrossHubs } from "../jobs/runJob.js";
import { isCronAuthorized } from "../jobs/cronAuth.js";
import { requestedHub } from "../services/cronHubs.js";

function handlerFor(job: JobSpec, calledAs: string) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!isCronAuthorized(req.headers.authorization)) {
      res.status(401).json({ error: "Invalid or missing cron credential" });
      return;
    }
    if (calledAs !== job.path) {
      console.warn(
        `[jobs] ${job.id} called on the deprecated path /internal${calledAs}; schedule /internal${job.path} instead`,
      );
    }
    const onlyHub = requestedHub(req.query);
    if (onlyHub === undefined) {
      res.status(400).json({ error: "hub must be a hub slug" });
      return;
    }
    const force = req.query.force === "true" || req.query.force === "1";
    const runner = JOB_RUNNERS[job.id];
    if (!runner) {
      res.status(500).json({ error: `job "${job.id}" has no runner` });
      return;
    }
    const report = await runJobAcrossHubs(job, runner, { now: new Date(), force, onlyHub });
    if ("error" in report) {
      res.status(report.status).json({ error: report.error });
      return;
    }
    res.status(report.status).json({ job: job.id, hubs: report.hubs });
  };
}

export const jobRouter = Router();
for (const job of JOBS) {
  for (const path of [job.path, ...(job.deprecatedPaths ?? [])]) {
    jobRouter.get(path, (req, res, next) => {
      handlerFor(job, path)(req, res).catch(next);
    });
  }
}
