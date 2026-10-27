// The console's Dashboard (GET /control/dashboard, the dashboard slice, 2026-10-17).
//
// - only the console's operator gets it: no session, a hub's session, or a
//   hub's hostname are refused;
// - every section comes back, in order, each with its own status;
// - a hub that never answers its health check is "down" after the timeout,
//   and the page still answers with every other hub;
// - with no outside keys (as in CI) the backup, uptime and errors cards are
//   "not connected" with their setup line, and the page does not fail;
// - an empty job_last_run shows every job as never run; a scheduled run
//   records itself, a run for one hub by hand does not;
// - the waiting counts are what is pending, not what is new since an admin
//   last looked.
//
// Needs the server started with CIVIC_DASHBOARD_FAKE=on (as in CI): hubs'
// health is read from the server itself, and a hub whose slug contains
// "slow" never answers. Hubs are made by the console's Create hub and
// archived in afterAll; planted rows are deleted.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { API_BASE } from "../fixtures/helpers.js";

const run = Date.now().toString(36);
const SLOW = `dash-slow-${run}`;
const FLAKY = `dash-flaky-${run}`;
const FLOYD = "floyd.civic.social";
const MARK = `dash_${run}`;
const CRON = process.env.CIVIC_TEST_CRON_SECRET ?? "ci-only-cron-secret";

// The first gathering waits out the slow hub's two 8 s attempts.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Row = Record<string, any>;
type Section = { id: string; name: string; status: string; ms: number; data: any; message?: string };

let cookie = "";
const created: string[] = [];

async function dashboard(fresh = false): Promise<{ status: number; body: { gathered_at: string; sections: Section[] } }> {
  const res = await consoleCall("GET", `/control/dashboard${fresh ? "?fresh=1" : ""}`, { cookie });
  return res;
}

function section(body: { sections: Section[] }, id: string): Section {
  const s = body.sections.find((x) => x.id === id);
  expect(s, `section ${id}`).toBeTruthy();
  return s!;
}

async function attentionFor(hubId: string): Promise<Row> {
  const res = await dashboard();
  expect(res.status).toBe(200);
  const row = section(res.body, "attention").data.hubs.find((h: Row) => h.id === hubId);
  expect(row, `attention row for ${hubId}`).toBeTruthy();
  return row;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  for (const [slug, name] of [[SLOW, "Slow Test Hub"], [FLAKY, "Flaky Test Hub"]]) {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: {
        slug,
        name,
        hostname: `${slug}.localhost`,
        admin_email: "admin@example.test",
        jurisdiction_name: "Dashboard Test Area",
        jurisdiction_custom: true,
        jurisdiction_type: "county",
        mode: "beta",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
  }
});

afterAll(async () => {
  // Process rows stay (events point at them); archived, no later suite lists them.
  await localRest(`processes?hub_id=eq.floyd&id=like.${MARK}*`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "archived" }),
  });
  await localRest(`process_reviews?hub_id=eq.floyd&creator_id=eq.user_${MARK}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await localRest(`waitlist?hub_id=eq.floyd&email=like.${MARK}*`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await localRest(`feedback_submissions?hub_id=eq.floyd&id=like.${MARK}*`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  for (const id of created) {
    await plantCode("step_up", "424242");
    await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: "424242" } });
  }
});

describe("who gets the Dashboard", () => {
  it("is refused without a console session", async () => {
    expect((await consoleCall("GET", "/control/dashboard")).status).toBe(401);
  });

  it("is refused to a hub admin's session: a hub's sign-in is not the console's", async () => {
    const hubSession = await mintSession("floyd", "admin@example.test");
    const res = await consoleCall("GET", "/control/dashboard", { cookie: hubSession });
    expect(res.status).toBe(401);
  });

  it("does not exist on a hub's hostname", async () => {
    const hubAdmin = await mintSession("floyd", "admin@example.test");
    const res = await call("GET", "/control/dashboard", FLOYD, undefined, hubAdmin);
    expect(res.status).toBe(404);
  });
});

describe("GET /control/dashboard", () => {
  it("answers every section, in order, with when it was gathered", async () => {
    const res = await dashboard(false);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sections.map((s) => s.id)).toEqual(["hubs", "jobs", "outside", "attention", "plugins", "activity"]);
    expect(Math.abs(Date.now() - Date.parse(res.body.gathered_at))).toBeLessThan(60_000);
  });

  it("Activity (ADR-016): each live hub's report for every period, the sum, counts only", async () => {
    const res = await dashboard(true);
    const activity = section(res.body, "activity");
    expect(activity.status, activity.message).toBe("ok");
    const data = activity.data as {
      periods: Record<string, { hubs: Array<{ id: string; report: { totals: Record<string, number>; by_type: unknown[] } | null }>; sum: Record<string, number> }>;
    };
    expect(Object.keys(data.periods)).toEqual(["week", "month", "quarter", "all"]);
    const floyd = data.periods.month.hubs.find((h) => h.id === "floyd");
    expect(floyd?.report?.by_type.length).toBeGreaterThan(0);
    for (const kind of Object.keys(data.periods)) {
      const { hubs, sum } = data.periods[kind];
      expect(sum.active_residents).toBe(hubs.reduce((n, h) => n + (h.report?.totals.active_residents ?? 0), 0));
    }
    // Nothing per person: no account id, no address.
    expect(JSON.stringify(activity.data)).not.toMatch(/user_[0-9a-f]{8}|@example\.test/);
  });

  it("a hub that never answers is down after two 8 s attempts; the other hubs and sections still come back", async () => {
    const started = Date.now();
    const res = await dashboard(true);
    expect(res.status).toBe(200);
    // Two 8 s attempts, inside the hubs section's own limit.
    expect(Date.now() - started).toBeLessThan(30_000);
    const hubs = section(res.body, "hubs");
    expect(hubs.status).toBe("ok");
    const slow = hubs.data.hubs.find((h: Row) => h.id === SLOW);
    expect(slow, "the slow hub's row").toBeTruthy();
    expect(slow.health).toMatchObject({ state: "down", http_status: null, reason: "no answer in 8 s", attempts: 2 });
    expect(slow.health.ms).toBeGreaterThanOrEqual(16_000);
    expect(slow.group).toBe("beta");
    const floyd = hubs.data.hubs.find((h: Row) => h.id === "floyd");
    expect(floyd.health, "start the server with CIVIC_DASHBOARD_FAKE=on").toMatchObject({ state: "up", attempts: 1 });
    expect(floyd.members).toEqual(expect.any(Number));
    for (const s of res.body.sections) expect(s.status, s.id).toBe("ok");
  });

  it("a hub whose first answer fails and whose retry answers is slow, with the time and why, not down", async () => {
    const res = await dashboard();
    const flaky = section(res.body, "hubs").data.hubs.find((h: Row) => h.id === FLAKY);
    expect(flaky, "the flaky hub's row").toBeTruthy();
    expect(flaky.health).toMatchObject({ state: "slow", attempts: 2, reason: "first try: connection dropped" });
    expect(flaky.health.ms).toEqual(expect.any(Number));
  });

  it("orders hubs live, beta, demo, then archived", async () => {
    const res = await dashboard(false);
    const order = ["live", "beta", "demo", "archived"];
    const groups = section(res.body, "hubs").data.hubs.map((h: Row) => order.indexOf(h.group));
    expect(groups).toEqual([...groups].sort((a: number, b: number) => a - b));
  });

  it("with no outside keys, the backup, uptime and errors are not connected and say how", async () => {
    const res = await dashboard(false);
    const backup = section(res.body, "jobs").data.backup;
    const outside = section(res.body, "outside");
    expect(outside.status).toBe("ok");
    for (const card of [backup, outside.data.uptime, outside.data.errors]) {
      expect(card.state).toBe("not_connected");
      expect(card.setup).toMatch(/Vercel/);
    }
  });
});

describe("jobs", () => {
  it("an empty job_last_run shows every job as never run, with its next run", async () => {
    await localRest("job_last_run?job_id=neq.__none__", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    const jobs = section((await dashboard()).body, "jobs");
    expect(jobs.status).toBe("ok");
    expect(jobs.data.jobs.length).toBeGreaterThan(0);
    for (const j of jobs.data.jobs) {
      expect(j.last, j.id).toBeNull();
      expect(Date.parse(j.next_run_at)).toBeGreaterThan(Date.now() - 60_000);
    }
  });

  it("a scheduled run records itself even when it did nothing; a run for one hub does not", async () => {
    const cron = (path: string) =>
      fetch(`${API_BASE}/internal${path}`, { headers: { Authorization: `Bearer ${CRON}` } }).then((r) => r.status);
    expect(await cron("/digest/run?hub=floyd")).toBe(200);
    expect(await cron("/vote-close/run")).toBe(200);
    const jobs = section((await dashboard()).body, "jobs").data.jobs as Row[];
    const voteClose = jobs.find((j) => j.id === "vote_close")!;
    expect(voteClose.last).toMatchObject({ status: "ok", hubs_failed: 0 });
    expect(voteClose.last.hubs_run).toBeGreaterThan(0);
    expect(voteClose.late).toBe(false);
    expect(voteClose.attention).toBe(false);
    expect(jobs.find((j) => j.id === "digest")!.last).toBeNull();
  });
});

describe("waiting for attention", () => {
  it("counts what is pending, even after an admin has opened the tab, with links to the hub's queues", async () => {
    const before = await attentionFor("floyd");
    const admin = await mintSession("floyd", "admin@example.test");

    const procs = (await localRest("processes?hub_id=eq.floyd&type=eq.civic.vote&select=id&limit=1")) as Array<{ id: string }>;
    expect(procs.length).toBe(1);
    const review = (i: number, flagged: boolean) => ({
      id: `${MARK}_rev_${i}`,
      hub_id: "floyd",
      process_id: procs[0].id,
      creator_id: `user_${MARK}`,
      creator_name: "Dashboard test",
      creator_email: `${MARK}@example.test`,
      status: "pending_review",
      coc_flags: flagged ? [{ rule: "test", quote: "x" }] : null,
    });
    await localRest("process_reviews", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([review(1, false), review(2, false), review(3, true)]),
    });
    await localRest("waitlist", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([
        { hub_id: "floyd", email: `${MARK}-a@example.test` },
        { hub_id: "floyd", email: `${MARK}-b@example.test` },
      ]),
    });
    await localRest("feedback_submissions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ id: `${MARK}_fb`, hub_id: "floyd", category: "idea", message: "Dashboard test" }),
    });
    // The admin opens the Reviews tab: its badge drops, the Dashboard's count does not.
    expect((await call("POST", "/admin/queues/reviews/seen", FLOYD, {}, admin)).status).toBe(200);

    const after = await attentionFor("floyd");
    expect(after.counts.reviews - before.counts.reviews).toBe(3);
    expect(after.counts.flagged - before.counts.flagged).toBe(1);
    expect(after.counts.waitlist - before.counts.waitlist).toBe(2);
    if (before.counts.feedback !== null) expect(after.counts.feedback - before.counts.feedback).toBe(1);
    expect(after.total).toBeGreaterThanOrEqual(before.total + 5);
    expect(after.links.reviews).toMatch(/\/admin\/reviews$/);
    expect(after.links.waitlist).toMatch(/\/admin\/settings\/mode#waitlist$/);
    expect(new URL(after.links.reviews).hostname).toBe(FLOYD);
  });

  it("counts a meeting summary as flagged only when it carries a quality flag", async () => {
    const before = await attentionFor("floyd");
    expect(before.counts.meeting_summaries, "Floyd's meeting-summary plugin is on in the seed").not.toBeNull();
    const summary = (suffix: string, flag: Row | null) => ({
      id: `${MARK}_ms_${suffix}`,
      hub_id: "floyd",
      type: "civic.meeting_summary",
      title: "Dashboard test summary",
      description: "",
      status: "active",
      // A summary with no flag stores JSON null, as the module writes it.
      state: { approval_status: "pending", quality_flag: flag },
    });
    await localRest("processes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([summary("plain", null), summary("flagged", { code: "transcript_unavailable", message: "test" })]),
    });
    const after = await attentionFor("floyd");
    expect(after.counts.meeting_summaries - before.counts.meeting_summaries).toBe(2);
    expect(after.counts.flagged - before.counts.flagged).toBe(1);
  });

  it("leaves archived hubs out", async () => {
    const res = await dashboard(false);
    const ids = section(res.body, "attention").data.hubs.map((h: Row) => h.id);
    const archived = section(res.body, "hubs").data.hubs.filter((h: Row) => h.group === "archived").map((h: Row) => h.id);
    for (const id of archived) expect(ids).not.toContain(id);
  });
});
