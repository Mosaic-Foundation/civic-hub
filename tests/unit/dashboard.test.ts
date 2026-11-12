// The hub's sections of the console's Dashboard, the parts that need no
// database: the section runner's timeout, reading a hub's health answer, and
// the jobs' rows from an empty table. (The outside services' cards are the
// console's, since the console split.)

import { afterEach, describe, expect, it } from "vitest";
import { runSection, runSections, type DashboardSection } from "../../src/shared/dashboardRun.js";
import { checkWithRetry, readHealth } from "../../src/operator/dashboard/hubHealth.js";
import { jobRows } from "../../src/operator/dashboard/jobs.js";
import { clearDashboardCache } from "../../src/operator/dashboard/cache.js";
import { JOBS } from "../../src/jobs/registry.js";

afterEach(() => {
  clearDashboardCache();
});

describe("dashboard sections", () => {
  it("a slow section times out on its own and the others still load", async () => {
    const slow: DashboardSection = { id: "slow", name: "Slow", load: () => new Promise(() => {}), timeoutMs: 50 };
    const quick: DashboardSection = { id: "quick", name: "Quick", load: async () => ({ n: 1 }) };
    const broken: DashboardSection = { id: "broken", name: "Broken", load: async () => { throw new Error("boom"); } };
    const sections = await runSections([slow, quick, broken], { now: new Date(), fresh: false });
    const page = { sections, gathered_at: new Date().toISOString() };
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

describe("a hub's health check, with one retry", () => {
  const ok = { status: 200, body: JSON.stringify({ status: "ok", commit: "abc" }) };
  const noAnswer = () => Promise.reject(new Error("no answer in 8 s"));
  // A clock that moves 5 s per reading, so the check's time is known.
  const clock = () => {
    let t = 0;
    return () => (t += 5_000);
  };

  it("an answer on the first try is up, asked once", async () => {
    const asked: number[] = [];
    const h = await checkWithRetry(async (n) => (asked.push(n), ok));
    expect(h).toMatchObject({ state: "up", attempts: 1, commit: "abc" });
    expect(asked).toEqual([1]);
  });

  it("a failed first try that answers on the retry is slow, with the whole check's time and why", async () => {
    const asked: number[] = [];
    const h = await checkWithRetry(async (n) => (asked.push(n), n === 1 ? noAnswer() : ok), clock());
    expect(asked).toEqual([1, 2]);
    expect(h).toMatchObject({ state: "slow", attempts: 2, commit: "abc", reason: "first try: no answer in 8 s", ms: 5_000 });
  });

  it("an answer that is neither 200 nor a 503 report is retried too", async () => {
    const h = await checkWithRetry(async (n) => (n === 1 ? { status: 504, body: "Gateway timeout" } : ok));
    expect(h).toMatchObject({ state: "slow", reason: "first try: answered 504" });
  });

  it("two failures are down, with the last reason", async () => {
    const h = await checkWithRetry(async (n) => (n === 1 ? noAnswer() : Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))));
    expect(h).toMatchObject({ state: "down", attempts: 2, reason: "connection refused", http_status: null });
  });

  it("a 503 report is an answer: degraded, not retried", async () => {
    const asked: number[] = [];
    const h = await checkWithRetry(async (n) => (asked.push(n), { status: 503, body: JSON.stringify({ db: { ok: false } }) }));
    expect(asked).toEqual([1]);
    expect(h).toMatchObject({ state: "degraded", attempts: 1 });
  });

  it("a retry that finds the hub degraded says degraded, not slow", async () => {
    const h = await checkWithRetry(async (n) => (n === 1 ? noAnswer() : { status: 503, body: JSON.stringify({ schema: { gaps: ["t: c"] } }) }));
    expect(h).toMatchObject({ state: "degraded", attempts: 2, gaps: ["t: c"] });
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
    expect(ok).toMatchObject({ late: false, attention: false, next_run_at: "2026-10-17T12:20:00.000Z" });
    const failed = jobRows({ vote_close: run("failed") }, now).find((r) => r.id === "vote_close")!;
    expect(failed).toMatchObject({ late: false, attention: true });
  });
});
