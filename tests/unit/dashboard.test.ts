// The console's Dashboard, the parts that need no database: the section
// runner's timeout, reading a hub's health answer, the outside services'
// answers and their "not connected", and the jobs' rows from an empty table.

import { afterEach, describe, expect, it } from "vitest";
import { runSection, gatherDashboard, type DashboardSection } from "../../src/control/dashboard/registry.js";
import { readHealth } from "../../src/control/dashboard/hubHealth.js";
import {
  backupStatus,
  errorsStatus,
  parseErrors,
  parseUptime,
  uptimeStatus,
  SETUP,
} from "../../src/control/dashboard/outside.js";
import { jobRows } from "../../src/control/dashboard/jobs.js";
import { clearDashboardCache } from "../../src/control/dashboard/cache.js";
import { JOBS } from "../../src/jobs/registry.js";

const KEYS = ["HEALTHCHECKS_READ_KEY", "BETTERSTACK_API_TOKEN", "SENTRY_READ_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearDashboardCache();
});

function fakeFetch(status: number, body: unknown, seen: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("dashboard sections", () => {
  it("a slow section times out on its own and the others still load", async () => {
    const slow: DashboardSection = { id: "slow", name: "Slow", load: () => new Promise(() => {}), timeoutMs: 50 };
    const quick: DashboardSection = { id: "quick", name: "Quick", load: async () => ({ n: 1 }) };
    const broken: DashboardSection = { id: "broken", name: "Broken", load: async () => { throw new Error("boom"); } };
    const page = await gatherDashboard({ sections: [slow, quick, broken] });
    expect(page.sections.map((s) => [s.id, s.status])).toEqual([
      ["slow", "timeout"],
      ["quick", "ok"],
      ["broken", "error"],
    ]);
    expect(page.sections[1].data).toEqual({ n: 1 });
    // The error's own text stays in the server log, not on the page.
    expect(page.sections[2].message).toBe("This section could not be loaded.");
    expect(Date.parse(page.gathered_at)).not.toBeNaN();
  });

  it("runs one section and reports its time", async () => {
    const r = await runSection({ id: "x", name: "X", load: async () => 1 }, { now: new Date(), fresh: false });
    expect(r.status).toBe("ok");
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
});

describe("a hub's health answer", () => {
  it("200 ok is up, with its commit", () => {
    expect(readHealth(200, JSON.stringify({ status: "ok", commit: "abc", schema: { gaps: [] } }))).toMatchObject({
      state: "up",
      commit: "abc",
      gaps: [],
    });
  });

  it("503 with JSON is degraded, with its gaps and why", () => {
    const h = readHealth(503, JSON.stringify({ status: "degraded", db: { ok: true }, hub_db: { ok: true }, schema: { gaps: ["job_last_run: missing"] }, commit: "abc" }));
    expect(h).toMatchObject({ state: "degraded", gaps: ["job_last_run: missing"], reason: "schema gaps" });
    expect(readHealth(503, JSON.stringify({ db: { ok: false } })).reason).toBe("database not answering");
  });

  it("anything else is down", () => {
    expect(readHealth(403, "request was blocked")).toMatchObject({ state: "down", reason: "answered 403" });
    expect(readHealth(503, "<html>")).toMatchObject({ state: "down" });
  });
});

describe("the outside services", () => {
  it("each is not connected without its key, says how, and calls nothing", async () => {
    for (const k of KEYS) delete process.env[k];
    const seen: string[] = [];
    const f = fakeFetch(200, {}, seen);
    expect(await backupStatus(false, f)).toEqual({ state: "not_connected", setup: SETUP.backup });
    expect(await uptimeStatus(false, f)).toEqual({ state: "not_connected", setup: SETUP.uptime });
    expect(await errorsStatus(false, f)).toEqual({ state: "not_connected", setup: SETUP.errors });
    expect(seen).toEqual([]);
  });

  it("Sentry needs the organization and project as well as the token", async () => {
    process.env.SENTRY_READ_TOKEN = "t";
    delete process.env.SENTRY_ORG;
    expect((await errorsStatus(false, fakeFetch(200, []))).state).toBe("not_connected");
  });

  it("reads the backup check with a GET and the read-only key", async () => {
    process.env.HEALTHCHECKS_READ_KEY = "read-only";
    const seen: string[] = [];
    const r = await backupStatus(false, fakeFetch(200, { checks: [{ status: "up", last_ping: "2026-10-17T12:17:30+00:00", next_ping: "2026-10-17T18:17:30+00:00" }] }, seen));
    expect(r).toEqual({ state: "connected", data: { status: "up", last_ping: "2026-10-17T12:17:30+00:00", next_ping: "2026-10-17T18:17:30+00:00" } });
    expect(seen).toEqual(["GET https://healthchecks.io/api/v3/checks/?slug=backup-dump"]);
  });

  it("a refused key or a failing service is an error on that card, not a throw", async () => {
    process.env.HEALTHCHECKS_READ_KEY = "wrong";
    expect(await backupStatus(true, fakeFetch(401, {}))).toEqual({ state: "error", message: "the key was refused (401)" });
    expect(await backupStatus(true, fakeFetch(500, {}))).toEqual({ state: "error", message: "answered 500" });
    expect(await backupStatus(true, fakeFetch(200, { checks: [] }))).toEqual({ state: "error", message: "no backup-dump check in the project" });
  });

  it("is cached for a minute unless fresh", async () => {
    process.env.HEALTHCHECKS_READ_KEY = "k";
    const seen: string[] = [];
    const f = fakeFetch(200, { checks: [{ status: "up" }] }, seen);
    await backupStatus(false, f);
    await backupStatus(false, f);
    expect(seen).toHaveLength(1);
    await backupStatus(true, f);
    expect(seen).toHaveLength(2);
  });

  it("reads Better Stack's monitors", () => {
    expect(
      parseUptime({ data: [
        { attributes: { pronounceable_name: "Hub A", status: "up", last_checked_at: "2026-10-17T12:00:00Z" } },
        { attributes: { url: "https://b.example/api/health", status: "down" } },
      ] }),
    ).toEqual({
      up: 1,
      total: 2,
      monitors: [
        { name: "Hub A", status: "up", last_checked_at: "2026-10-17T12:00:00Z" },
        { name: "https://b.example/api/health", status: "down", last_checked_at: null },
      ],
    });
  });

  it("sums Sentry's last 24 hours per issue, busiest first", () => {
    const r = parseErrors([
      { title: "A", level: "error", stats: { "24h": [[1, 2], [2, 3]] }, permalink: "https://sentry.example/1" },
      { title: "B", level: "warning", stats: { "24h": [[1, 9]] } },
    ]);
    expect(r.events).toBe(14);
    expect(r.issues).toBe(2);
    expect(r.top.map((t) => [t.title, t.count])).toEqual([["B", 9], ["A", 5]]);
  });
});

describe("the jobs' rows", () => {
  it("an empty job_last_run shows every job never run, and late once due", () => {
    const rows = jobRows({}, new Date("2026-10-17T12:00:00Z"));
    expect(rows.map((r) => r.id)).toEqual(JOBS.map((j) => j.id));
    for (const r of rows) {
      expect(r.last).toBeNull();
      expect(r.next_run_at).not.toBeNull();
      expect(r.late).toBe(true);
      expect(r.attention).toBe(true);
    }
  });

  it("a recent run is not late; a failed one stands out", () => {
    const now = new Date("2026-10-17T12:10:00Z");
    const run = (status: "ok" | "failed") => ({
      job_id: "vote_close",
      started_at: "2026-10-17T12:05:01Z",
      finished_at: "2026-10-17T12:05:03Z",
      status,
      duration_ms: 2000,
      hubs_run: 3,
      hubs_failed: status === "failed" ? 1 : 0,
      error: null,
    });
    const ok = jobRows({ vote_close: run("ok") }, now).find((r) => r.id === "vote_close")!;
    expect(ok).toMatchObject({ late: false, attention: false, next_run_at: "2026-10-17T13:05:00.000Z" });
    const failed = jobRows({ vote_close: run("failed") }, now).find((r) => r.id === "vote_close")!;
    expect(failed).toMatchObject({ late: false, attention: true });
  });
});
