// Make (or update) the Healthchecks.io checks the scheduled jobs ping
// (operations shell; RUNBOOK-operations.md → Heartbeats).
//
// One check per job in src/jobs/registry.ts, plus the backups repo's dump,
// each with the job's own cron schedule (UTC), a grace period that fits how
// often it runs, and every alert channel on the project (email, ntfy). Safe
// to run again: checks are matched by slug and updated in place. Run it after
// adding or rescheduling a job, once the new schedule is LIVE on production
// (vote_close went from hourly to every 15 minutes in Architecture 2: a
// check synced first would alert on production's hourly pings).
//
//   node --env-file=$HOME/civic-keys/healthchecks.env --import tsx scripts/heartbeats-sync.ts [--dry-run]
//
// HEALTHCHECKS_API_KEY: the project's API key (Settings → API Access), full
// access. Read from the environment, never printed.

import { JOBS } from "../src/jobs/registry.js";
import { heartbeatSlug } from "../src/hosting/healthchecks.js";
import { graceFor } from "../src/jobs/schedule.js";

const API = "https://healthchecks.io/api/v3/checks/";

/**
 * A cron check (`schedule`, UTC) or a period check (`timeout`, seconds), with
 * `grace` seconds before the alert. Healthchecks.io makes a period ("simple")
 * check when it is sent a timeout and no schedule.
 */
type Check = {
  slug: string;
  name: string;
  desc: string;
  grace: number;
} & ({ schedule: string; timeout?: never } | { timeout: number; schedule?: never });

const HOUR = 60 * 60;

// How late a ping may be before the alert: graceFor (src/jobs/schedule.ts),
// shared with the console's Dashboard so both call the same run late.
export { graceFor };

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
  //
  // A period check, not the cron schedule (Adam, 2026-10-19): GitHub starts
  // the scheduled dumps 2½ to 4½ hours late, so a cron check with an hour's
  // grace alerted on dumps that came. Every 6 hours with 6 hours' grace
  // alerts only when no dump has arrived for 12 hours, which is two missed.
  const backup: Check = {
    slug: "backup-dump",
    name: "Backup: database dump",
    desc: "civic-hub-backups dump.yml pings after an encrypted dump is uploaded.",
    timeout: 6 * HOUR,
    grace: 6 * HOUR,
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
    const when = c.schedule ?? `every ${c.timeout / HOUR} h`;
    const line = `${c.slug.padEnd(20)} ${when.padEnd(20)} grace ${c.grace / 60} min`;
    if (dryRun) {
      console.log(`would sync  ${line}`);
      continue;
    }
    const res = await fetch(API, {
      method: "POST",
      headers: { "X-Api-Key": key!, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...c,
        ...(c.schedule ? { tz: "UTC" } : {}),
        unique: ["slug"],
        channels: "*",
        tags: "civic-hub production",
      }),
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
