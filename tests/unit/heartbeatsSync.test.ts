// The Healthchecks.io checks heartbeats-sync makes (operations shell). The
// backup dump is a period check since 2026-10-19: GitHub starts the scheduled
// dumps hours late, and a cron check with an hour's grace alerted on dumps
// that came.

import { describe, expect, it } from "vitest";
import { checks } from "../../scripts/heartbeats-sync.js";

describe("heartbeats-sync's checks", () => {
  it("the backup dump: every 6 hours, 6 hours' grace, no cron schedule", () => {
    const backup = checks().find((c) => c.slug === "backup-dump")!;
    expect(backup).toMatchObject({ timeout: 6 * 3600, grace: 6 * 3600 });
    expect(backup.schedule).toBeUndefined();
  });

  it("every job keeps its own cron schedule", () => {
    const jobs = checks().filter((c) => c.slug !== "backup-dump");
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) expect(j.schedule, j.slug).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
  });
});
