import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One list of scheduled jobs, and nothing that can drift from it.
 *
 * vercel.json's "crons" is what Vercel actually runs; src/jobs/registry.ts is
 * what the app mounts. Before Phase 2c they were two hand-kept lists. This
 * test is the reason they cannot disagree: change a job and it fails until
 * vercel.json is regenerated (`npm run jobs:crontab -- --vercel`).
 */

import { JOBS, crontab, internalPath, isPlatformJob, vercelCrons } from "../../src/jobs/registry.js";
import { PLUGIN_IDS } from "../../src/models/hubSettings.js";

const runnersModule = await import("../../src/jobs/runners.js");
const { jobRouter } = await import("../../src/routes/jobRoutes.js");

describe("job registry", () => {
  it("vercel.json schedules exactly the registry's jobs", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    expect(vercel.crons).toEqual(vercelCrons());
  });

  it("covers every job the brief names: both digests, meeting summaries, news sync, the vote close, the export sweep", () => {
    expect(JOBS.map((j) => j.id).sort()).toEqual(
      ["admin_digest", "digest", "hub_exports_sweep", "meeting_summary", "news_sync", "vote_close"].sort(),
    );
  });

  it("the vote close is a Votes job that runs hourly", () => {
    const job = JOBS.find((j) => j.id === "vote_close")!;
    expect(!isPlatformJob(job) && job.plugin).toBe("vote");
    expect(job.schedule.split(" ").slice(1).join(" ")).toBe("* * * *");
  });

  it("gives every job a runner of its scope, and every runner a job", () => {
    const hubJobs = JOBS.filter((j) => !isPlatformJob(j)).map((j) => j.id).sort();
    const platformJobs = JOBS.filter(isPlatformJob).map((j) => j.id).sort();
    expect(Object.keys(runnersModule.JOB_RUNNERS).sort()).toEqual(hubJobs);
    expect(Object.keys(runnersModule.PLATFORM_JOB_RUNNERS).sort()).toEqual(platformJobs);
  });

  it("the export sweep is a platform job that runs hourly", () => {
    const sweep = JOBS.find((j) => j.id === "hub_exports_sweep")!;
    expect(isPlatformJob(sweep)).toBe(true);
    expect(sweep.schedule.split(" ").slice(1).join(" ")).toBe("* * * *");
  });

  it("names a real plugin for every hub job, and no two jobs share a path", () => {
    for (const job of JOBS) if (!isPlatformJob(job)) expect(PLUGIN_IDS).toContain(job.plugin);
    const paths = JOBS.flatMap((j) => [j.path, ...(j.deprecatedPaths ?? [])]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("mounts a GET route for every path, deprecated aliases included", () => {
    const mounted = (jobRouter.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>)
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods).join(",")} ${l.route!.path}`);
    for (const job of JOBS) {
      for (const p of [job.path, ...(job.deprecatedPaths ?? [])]) expect(mounted).toContain(`get ${p}`);
    }
  });

  it("the digest runs hourly, so each hub can be mailed in its own hour", () => {
    expect(JOBS.find((j) => j.id === "digest")!.schedule).toBe("0 * * * *");
  });

  it("emits a crontab line per job with the same schedule and path", () => {
    const tab = crontab({ baseUrl: "https://hub.example" });
    for (const job of JOBS) {
      expect(tab).toContain(`${job.schedule} curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://hub.example/api${internalPath(job)}"`);
    }
    expect(crontab({ prefix: "" })).toContain('"${CIVIC_CRON_BASE_URL}/internal/digest/run"');
  });
});
