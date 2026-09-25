/**
 * Cron endpoint tests.
 *
 * Vercel Cron sends GET requests with Authorization: Bearer <CRON_SECRET>.
 * These tests verify:
 *   1. All four cron routes accept GET (not 404 — the exact bug that broke
 *      production crons when they were registered as POST-only).
 *   2. Missing or wrong auth is rejected with 401.
 *   3. POST is NOT accepted (crons must be GET-only to match Vercel's behavior).
 *
 * Note: valid-auth tests (200) require CRON_SECRET in the dev .env. When
 * CRON_SECRET is unset the handler rejects all requests, so the auth-gate
 * tests still pass — they just can't verify the happy path.
 *
 * THESE DESCRIBE A DEPLOYMENT THAT RUNS CRONS. A deployment with
 * HUB_CRON_ENABLED=false answers every one of these routes with 200
 * "disabled" before auth is looked at, which is the whole point of that
 * switch — so against such a server the auth-gate assertions are meaningless
 * rather than failing. They skip with a reason instead of producing twelve
 * red lines that say nothing about the code. See src/config/cron.ts and
 * tests/unit/devSafety.test.ts, which cover the switch itself.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../fixtures/helpers";

/** Does the server under test run scheduled work? */
let cronsEnabled = true;

beforeAll(async () => {
  const res = await api("/internal/digest/run", { method: "GET" });
  cronsEnabled = !(res.status === 200 && (await res.clone().text()) === "disabled");
  if (!cronsEnabled) {
    console.warn(
      "[crons.test] server has HUB_CRON_ENABLED=false — auth-gate tests skipped",
    );
  }
});

const CRON_PATHS = [
  "/internal/news-sync/run",
  // Deprecated alias, kept until the cutover because production's vercel.json
  // on main still schedules it. Delete this line when the alias is removed.
  "/internal/floyd-news-sync/run",
  "/internal/digest/run",
  "/internal/meeting-summary/run",
  "/internal/admin-digest/run",
];

describe("Cron endpoints", () => {
  for (const path of CRON_PATHS) {
    const label = path.replace("/internal/", "").replace("/run", "");

    describe(label, () => {
      it("accepts GET (not 404)", async () => {
        const res = await api(path, { method: "GET" });
        // Any status other than 404/405 proves the route is registered for GET.
        // Without CRON_SECRET in dev, expect 401; with it, expect 200.
        expect(res.status).not.toBe(404);
        expect(res.status).not.toBe(405);
      });

      it("rejects missing auth with 401", async (ctx) => {
        if (!cronsEnabled) return ctx.skip();
        const res = await api(path, { method: "GET" });
        // No Authorization header → 401
        expect(res.status).toBe(401);
      });

      it("rejects wrong auth with 401", async (ctx) => {
        if (!cronsEnabled) return ctx.skip();
        const res = await api(path, {
          method: "GET",
          headers: { Authorization: "Bearer wrong-secret" },
        });
        expect(res.status).toBe(401);
      });

      it("rejects POST method", async (ctx) => {
        if (!cronsEnabled) return ctx.skip();
        const res = await api(path, { method: "POST" });
        // POST should return 404 or 405 since routes are GET-only
        const rejected = res.status === 404 || res.status === 405;
        expect(rejected).toBe(true);
      });

      it("is quiet when the deployment does not run crons", async (ctx) => {
        if (cronsEnabled) return ctx.skip();
        // The dev deployment. 200 rather than 503 because Vercel Cron retries
        // and alerts on a failure, and a deployment that is deliberately idle
        // is not failing.
        const res = await api(path, {
          method: "GET",
          headers: { Authorization: "Bearer wrong-secret" },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("disabled");
      });
    });
  }
});

// Phase 2c: an authorized run iterates every active hub and reports each.
// Only the two digests are run here: news sync and meeting summaries would
// fetch the seeded hubs' real sources. The secret is CI's (ci.yml); a local
// server started with another one sets CIVIC_TEST_CRON_SECRET.
const CRON_SECRET = process.env.CIVIC_TEST_CRON_SECRET ?? "ci-only-cron-secret";
const authed = { Authorization: `Bearer ${CRON_SECRET}` };

describe("Cron runs per hub", () => {
  it("the admin digest reports every active hub by id", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const res = await api("/internal/admin-digest/run", { method: "GET", headers: authed });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job).toBe("admin_digest");
    expect(Object.keys(body.hubs)).toEqual(expect.arrayContaining(["floyd", "athens"]));
  });

  it("?hub= runs one hub; an unknown hub is 404; a malformed one 400", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const one = await api("/internal/digest/run?hub=athens", { method: "GET", headers: authed });
    expect(one.status).toBe(200);
    expect(Object.keys((await one.json()).hubs)).toEqual(["athens"]);
    expect((await api("/internal/digest/run?hub=nowhere", { method: "GET", headers: authed })).status).toBe(404);
    expect((await api("/internal/digest/run?hub=Not_A_Slug", { method: "GET", headers: authed })).status).toBe(400);
  });

  it("a hub the digest does not run for says why", async (ctx) => {
    if (!cronsEnabled) return ctx.skip();
    const res = await api("/internal/digest/run?hub=athens", { method: "GET", headers: authed });
    const athens = (await res.json()).hubs.athens;
    // hubAdminSettings.test.ts may have switched Athens's digest off; if not,
    // either it is Athens's hour right now (and it ran) or it names the hour.
    if (athens.skipped && athens.reason === "not the send hour") {
      expect(typeof athens.send_hour).toBe("number");
      expect(typeof athens.time_zone).toBe("string");
    } else if (athens.skipped) {
      expect(athens.reason).toBe("plugin.digest.enabled is off");
    } else {
      expect(typeof athens.processed_users).toBe("number");
    }
  });
});
