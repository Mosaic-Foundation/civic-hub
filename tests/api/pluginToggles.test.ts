// Phase 2c: a plugin switched off in one hub's admin is gone from that hub —
// its routes 404, its process type cannot be created, read, listed or acted
// on, its job is skipped — while another hub on the same server is
// unaffected, and switching it back on brings back exactly what was there.
//
// Word clouds are the plugin under test: nothing else in tests/api uses them
// on Athens, and they are cheap to create. Files run one at a time
// (vitest.config.ts), so switching a plugin off here cannot leak into another
// file; afterAll removes the row, returning Athens to its seeded state.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const FLOYD = "floyd.civic.social";
const CRON_SECRET = process.env.CIVIC_TEST_CRON_SECRET ?? "ci-only-cron-secret";
const run = Date.now();

let athensAdmin = "";
let floydAdmin = "";
let athensCloud = "";
let floydCloud = "";

async function createCloud(host: string, token: string, title: string): Promise<{ status: number; id?: string }> {
  const res = await call(
    "POST",
    "/process",
    host,
    {
      definition: { type: "civic.wordcloud", version: "0.1" },
      title,
      description: "Plugin toggle test.",
      state: { prompts: [{ id: "p1", text: "One word?" }] },
    },
    token,
  );
  const id = res.body.id ?? res.body.process?.id;
  if (res.status === 201) {
    await call("POST", `/process/${id}/action`, host, { type: "process.activate", payload: {} }, token);
  }
  return { status: res.status, id };
}

async function setAthens(values: Record<string, string>) {
  const res = await call("PUT", "/admin/hub/settings", ATHENS, { section: "plugins", values }, athensAdmin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function athensConfig(): Promise<Record<string, string>> {
  return (await call("GET", "/hub-config", ATHENS)).body.settings;
}

beforeAll(async () => {
  athensAdmin = await mintSession("athens", "admin+athens@example.test");
  floydAdmin = await mintSession("floyd", "admin@example.test");
  athensCloud = (await createCloud(ATHENS, athensAdmin, `Athens cloud ${run}`)).id!;
  floydCloud = (await createCloud(FLOYD, floydAdmin, `Floyd cloud ${run}`)).id!;
  expect((await call("GET", `/wordcloud/${athensCloud}`, ATHENS)).status).toBe(200);
  await setAthens({ "plugin.wordcloud.enabled": "false", "plugin.admin_digest.enabled": "false" });
});

afterAll(async () => {
  for (const key of ["plugin.wordcloud.enabled", "plugin.admin_digest.enabled"]) {
    await localRest(`hub_settings?hub_id=eq.athens&key=eq.${key}`, { method: "DELETE" });
  }
  // The server caches settings; a save through the API is what clears it.
  await setAthens({ "plugin.wordcloud.enabled": "true", "plugin.admin_digest.enabled": "true" });
  for (const key of ["plugin.wordcloud.enabled", "plugin.admin_digest.enabled"]) {
    await localRest(`hub_settings?hub_id=eq.athens&key=eq.${key}`, { method: "DELETE" });
  }
});

describe("word clouds switched off on Athens", () => {
  it("the public config says so, on Athens only", async () => {
    expect((await athensConfig())["plugin.wordcloud.enabled"]).toBe("false");
    expect((await call("GET", "/hub-config", FLOYD)).body.settings["plugin.wordcloud.enabled"]).toBe("true");
  });

  it("its routes answer 404 on Athens, and still work on Floyd", async () => {
    expect((await call("GET", `/wordcloud/${athensCloud}`, ATHENS)).status).toBe(404);
    expect((await call("GET", `/wordcloud/${athensCloud}/cloud`, ATHENS)).status).toBe(404);
    expect((await call("GET", `/wordcloud/${floydCloud}`, FLOYD)).status).toBe(200);
  });

  it("an existing cloud cannot be read, listed or acted on by id on Athens", async () => {
    expect((await call("GET", `/process/${athensCloud}`, ATHENS)).status).toBe(404);
    expect((await call("GET", `/process/${athensCloud}/state`, ATHENS)).status).toBe(404);
    const list = await call("GET", "/process", ATHENS);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(athensCloud);
    const act = await call("POST", `/process/${athensCloud}/action`, ATHENS, { type: "process.close", payload: {} }, athensAdmin);
    expect(act.status).toBe(404);
  });

  it("a new one cannot be created on Athens, by POST /process or through review", async () => {
    expect((await createCloud(ATHENS, athensAdmin, `Refused ${run}`)).status).toBe(404);
    const review = await call(
      "POST",
      "/reviews/submit",
      ATHENS,
      { process_type: "civic.wordcloud", title: `Refused ${run}`, description: "x", state: {} },
      athensAdmin,
    );
    expect(review.status).toBe(404);
  });

  it("Floyd creates one as before", async () => {
    expect((await createCloud(FLOYD, floydAdmin, `Floyd still ${run}`)).status).toBe(201);
  });

  it("its events leave Athens's feed but stay on the protocol surface", async () => {
    const feed = await call("GET", "/feed", ATHENS);
    expect(JSON.stringify(feed.body)).not.toContain(athensCloud);
    const events = await call("GET", "/events?page=true", ATHENS);
    expect(JSON.stringify(events.body)).toContain(athensCloud);
  });
});

describe("a job switched off on Athens", () => {
  it("is skipped for Athens and runs for Floyd", async (ctx) => {
    const res = await call("GET", "/internal/admin-digest/run", ATHENS, undefined, CRON_SECRET);
    if (res.status === 200 && res.body === "disabled") return ctx.skip();
    expect(res.status).toBe(200);
    expect(res.body.hubs.athens).toEqual({ skipped: true, reason: "plugin.admin_digest.enabled is off" });
    expect(res.body.hubs.floyd.skipped).not.toBe(true);
  });
});

describe("switched back on", () => {
  it("restores everything that was there", async () => {
    await setAthens({ "plugin.wordcloud.enabled": "true" });
    expect((await athensConfig())["plugin.wordcloud.enabled"]).toBe("true");
    expect((await call("GET", `/wordcloud/${athensCloud}`, ATHENS)).status).toBe(200);
    expect((await call("GET", `/process/${athensCloud}/state`, ATHENS)).status).toBe(200);
    expect(JSON.stringify((await call("GET", "/process", ATHENS)).body)).toContain(athensCloud);
  });
});
