// Run a scheduled job from a plain cron on any host (ADR-012): the same run
// the /internal/*/run route makes for Vercel Cron, through the same
// runScheduledJob (src/jobs/scheduled.ts), so job_runs, job_last_run and the
// heartbeat are written the same way from both.
//
//   node --env-file=<env> --import tsx scripts/run-job.ts <job> <hub|--all> [--force]
//
//   <job>    a job id from src/jobs/registry.ts (vote_close or vote-close)
//   <hub>    one hub's slug: a run by hand (job_runs only, no heartbeat)
//   --all    every active hub: the scheduled run (heartbeat, job_last_run);
//            the only form a platform job (hub_exports_sweep) takes
//   --force  what ?force=true does on the route (the digest ignores its hour)
//
// A crontab line for each job, with its schedule: `npm run jobs:crontab`.
// Exits 1 when the run failed (status 500), 2 on a usage error. Honours
// HUB_CRON_ENABLED=false (prints that it did not run, exits 0), as the route
// does. Uses the service role, as every operator script does.

import { JOBS, isPlatformJob } from "../src/jobs/registry.js";
import { runScheduledJob } from "../src/jobs/scheduled.js";
import { cronsEnabled } from "../src/config/cron.js";
import { isWellFormedHubSlug } from "../src/models/hub.js";
import { prepareScript } from "./lib/hubScope.js";

function usage(message: string): never {
  console.error(`run-job: ${message}`);
  console.error("usage: run-job.ts <job> <hub|--all> [--force]");
  console.error(`jobs: ${JOBS.map((j) => j.id).join(", ")}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");
  const [jobArg, hubArg] = args;
  if (!jobArg || !hubArg) usage("name a job and a hub (or --all)");
  const id = jobArg.replace(/-/g, "_");
  const job = JOBS.find((j) => j.id === id);
  if (!job) usage(`no job "${jobArg}"`);
  const all = hubArg === "--all";
  if (!all && !isWellFormedHubSlug(hubArg)) usage(`"${hubArg}" is not a hub slug`);
  if (isPlatformJob(job) && !all) usage(`${job.id} is a platform job: it runs once for the deployment (--all)`);

  if (!cronsEnabled()) {
    console.log(`[run-job] ${job.id} not run — HUB_CRON_ENABLED=false`);
    return;
  }
  prepareScript();
  const started = Date.now();
  const run = await runScheduledJob(job, { force, onlyHub: all ? null : hubArg });
  console.log(JSON.stringify(run.body, null, 2));
  console.log(`[run-job] ${job.id} ${all ? "for every hub" : `for ${hubArg}`}: status ${run.status} in ${Date.now() - started} ms`);
  if (run.status >= 500) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[run-job] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
