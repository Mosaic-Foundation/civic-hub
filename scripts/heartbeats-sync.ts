// Make (or update) the Healthchecks.io checks the scheduled jobs ping
// (operations shell; RUNBOOK-operations.md → Heartbeats).
//
// One check per job in src/jobs/registry.ts, plus the backups repo's dump,
// each with the job's own cron schedule (UTC), a grace period that fits how
// often it runs, and every alert channel on the project (email, ntfy). Safe
// to run again: checks are matched by slug and updated in place. Run it after
// adding or rescheduling a job.
//
//   node --env-file=$HOME/civic-keys/healthchecks.env --import tsx scripts/heartbeats-sync.ts [--dry-run]
//
// HEALTHCHECKS_API_KEY: the project's API key (Settings → API Access), full
// access. Read from the environment, never printed.

import { JOBS } from "../src/jobs/registry.js";
import { heartbeatSlug } from "../src/utils/heartbeat.js";

const API = "https://healthchecks.io/api/v3/checks/";

interface Check {
  slug: string;
  name: string;
  desc: string;
  schedule: string;
  grace: number;
}

/** How late a ping may be before the alert: a third of the gap, within bounds. */
export function graceFor(schedule: string): number {
  const [minute, hour] = schedule.split(/\s+/);
  if (hour === "*") return minute.includes("*/") ? 10 * 60 : 20 * 60; // hourly
  if (hour.includes("*/") || hour.includes(",")) return 60 * 60; // every few hours
  return 2 * 60 * 60; // daily
}

export function checks(): Check[] {
  const jobs = JOBS.map((j) => ({
    slug: heartbeatSlug(j.id),
    name: `Job: ${j.id}`,
    desc: `${j.description} Pinged by civic-hub production when the run finishes; /fail when a hub failed.`,
    schedule: j.schedule,
    grace: graceFor(j.schedule),
  }));
  // civic-hub-backups/.github/workflows/dump.yml, "17 */6 * * *". Watched
  // from here because GitHub is what it would otherwise rely on.
  const backup: Check = {
    slug: "backup-dump",
    name: "Backup: database dump",
    desc: "civic-hub-backups dump.yml pings after an encrypted dump is uploaded.",
    schedule: "17 */6 * * *",
    grace: 60 * 60,
  };
  return [...jobs, backup];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const key = process.env.HEALTHCHECKS_API_KEY?.trim();
  if (!dryRun && !key) {
    console.error("HEALTHCHECKS_API_KEY is not set. Run with --env-file=$HOME/civic-keys/healthchecks.env.");
    process.exit(1);
  }
  for (const c of checks()) {
    const line = `${c.slug.padEnd(20)} ${c.schedule.padEnd(14)} grace ${c.grace / 60} min`;
    if (dryRun) {
      console.log(`would sync  ${line}`);
      continue;
    }
    const res = await fetch(API, {
      method: "POST",
      headers: { "X-Api-Key": key!, "Content-Type": "application/json" },
      body: JSON.stringify({ ...c, tz: "UTC", unique: ["slug"], channels: "*", tags: "civic-hub production" }),
    });
    if (res.status !== 200 && res.status !== 201) {
      console.error(`FAILED      ${line}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${res.status === 201 ? "created" : "updated"}     ${line}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
