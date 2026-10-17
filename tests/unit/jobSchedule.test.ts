// The cron reading behind the Dashboard's "next run" and "late" (src/jobs/schedule.ts).

import { describe, expect, it } from "vitest";
import { graceFor, isLate, nextRun, previousRun } from "../../src/jobs/schedule.js";
import { JOBS } from "../../src/jobs/registry.js";

const at = (iso: string) => new Date(iso);

describe("job schedule", () => {
  it("finds the next and previous run of an hourly job", () => {
    expect(nextRun("5 * * * *", at("2026-10-17T10:04:30Z"))?.toISOString()).toBe("2026-10-17T10:05:00.000Z");
    expect(nextRun("5 * * * *", at("2026-10-17T10:05:00Z"))?.toISOString()).toBe("2026-10-17T11:05:00.000Z");
    expect(previousRun("5 * * * *", at("2026-10-17T10:04:59Z"))?.toISOString()).toBe("2026-10-17T09:05:00.000Z");
  });

  it("reads steps and daily schedules", () => {
    expect(nextRun("17 */6 * * *", at("2026-10-17T06:18:00Z"))?.toISOString()).toBe("2026-10-17T12:17:00.000Z");
    expect(nextRun("30 13 * * *", at("2026-10-17T14:00:00Z"))?.toISOString()).toBe("2026-10-18T13:30:00.000Z");
  });

  it("finds a time for every job in the registry", () => {
    for (const job of JOBS) expect(nextRun(job.schedule, new Date()), job.id).not.toBeNull();
  });

  it("gives up on a malformed schedule", () => {
    expect(nextRun("61 * * * *", new Date())).toBeNull();
    expect(nextRun("* * *", new Date())).toBeNull();
    expect(isLate("nonsense", null, new Date())).toBe(false);
  });

  it("keeps the heartbeats' grace periods", () => {
    expect(graceFor("5 * * * *")).toBe(20 * 60);
    expect(graceFor("17 */6 * * *")).toBe(60 * 60);
    expect(graceFor("30 13 * * *")).toBe(2 * 60 * 60);
  });

  it("is late only once the grace has passed with no run since the due time", () => {
    const hourly = "5 * * * *";
    // Due 10:05, grace 20 min.
    expect(isLate(hourly, at("2026-10-17T09:05:10Z"), at("2026-10-17T10:20:00Z"))).toBe(false);
    expect(isLate(hourly, at("2026-10-17T09:05:10Z"), at("2026-10-17T10:26:00Z"))).toBe(true);
    expect(isLate(hourly, at("2026-10-17T10:05:20Z"), at("2026-10-17T10:26:00Z"))).toBe(false);
    expect(isLate(hourly, null, at("2026-10-17T10:26:00Z"))).toBe(true);
  });
});

describe("job schedule, day-of-week", () => {
  it("reads 7 as Sunday, in a range too", () => {
    // 2026-10-17 is a Saturday.
    expect(nextRun("0 9 * * 7", new Date("2026-10-17T12:00:00Z"))?.toISOString()).toBe("2026-10-18T09:00:00.000Z");
    expect(nextRun("0 9 * * 5-7", new Date("2026-10-17T12:00:00Z"))?.toISOString()).toBe("2026-10-18T09:00:00.000Z");
  });

  it("treats a stepped star as unrestricted when combining the day fields", () => {
    // Day-of-month */2 with day-of-week Monday: Monday only, as cron does.
    expect(nextRun("0 9 */2 * 1", new Date("2026-10-17T12:00:00Z"))?.toISOString()).toBe("2026-10-19T09:00:00.000Z");
  });
});
