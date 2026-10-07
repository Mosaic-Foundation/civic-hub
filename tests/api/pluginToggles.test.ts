// Phase 2c: a plugin switched off in one hub's admin is gone from that hub —
// its routes 404, its process type cannot be created, read, listed or acted
// on, its job is skipped — while another hub on the same server is
// unaffected, and switching it back on brings back exactly what was there.
//
// The last block (2026-10-07) walks EVERY plugin id the same way: its routes,
// creation, search, links, the admin digest, its job; plus the Code of
// Conduct check with the Writing assistant off, and a pending review of a
// switched-off type.
//
// Word clouds are the plugin under test here: nothing else in tests/api uses them
// on Athens, and they are cheap to create. Files run one at a time
// (vitest.config.ts), so switching a plugin off here cannot leak into another
// file; afterAll removes the row, returning Athens to its seeded state.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, storedSetting } from "../fixtures/adminSession.js";

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

// Phase 5 part one, step 0.4 (2026-09-26): what happens to a process that is
// in progress when its plugin goes off. The only timed transition is the
// lazy deadline-close (processService.autoCloseIfExpired, run by the read
// paths), and those paths drop a disabled type BEFORE the close runs. So a
// vote whose deadline passes while its plugin is off does not close: no
// tally, no results record, no civic.process.ended. It closes on the first
// read after the plugin is back on. Since Phase 5 part two (fix 6) that close
// is STAMPED WITH THE DEADLINE (every event it emits), and RECORDED when it
// ran (events.recorded_at), which is what the digest selects by.
describe("a vote in progress when its plugin goes off", () => {
  let voteId = "";
  let reEnabledAt = 0;
  const deadline = new Date(Date.now() - 60_000).toISOString();

  async function storedVote(): Promise<{ status: string; state: Record<string, unknown> }> {
    const rows = (await localRest(`processes?id=eq.${voteId}&select=status,state`)) as Array<{
      status: string;
      state: Record<string, unknown>;
    }>;
    return rows[0];
  }

  async function endedEvents(): Promise<Array<{ created_at: string; recorded_at: string }>> {
    return (await localRest(
      `events?process_id=eq.${voteId}&event_type=eq.civic.process.ended&select=created_at,recorded_at`,
    )) as Array<{ created_at: string; recorded_at: string }>;
  }

  afterAll(async () => {
    await localRest("hub_settings?hub_id=eq.athens&key=eq.plugin.vote.enabled", { method: "DELETE" });
    await setAthens({ "plugin.vote.enabled": "true" });
    await localRest("hub_settings?hub_id=eq.athens&key=eq.plugin.vote.enabled", { method: "DELETE" });
  });

  it("a vote is open on Athens, and its deadline passes while the plugin is off", async () => {
    const created = await call(
      "POST",
      "/process",
      ATHENS,
      {
        definition: { type: "civic.vote", version: "0.1" },
        title: `Toggle vote ${run}`,
        description: "A vote whose plugin is switched off mid-flight.",
        state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
      },
      athensAdmin,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    voteId = created.body.id ?? created.body.process?.id;
    const activated = await call("POST", `/process/${voteId}/action`, ATHENS, { type: "process.activate", payload: {} }, athensAdmin);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);

    // The Plugins page's warning counts it, for admins only.
    const live = await call("GET", "/admin/hub/plugins/live", ATHENS, undefined, athensAdmin);
    expect(live.status).toBe(200);
    expect(live.body.counts.vote).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/admin/hub/plugins/live", ATHENS)).status).toBe(401);

    await setAthens({ "plugin.vote.enabled": "false" });

    // The deadline passes while the plugin is off.
    const { state } = await storedVote();
    await localRest(`processes?id=eq.${voteId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...state, voting_closes_at: deadline } }),
    });
  });

  it("reads while it is off do not close it: no transition runs", async () => {
    expect((await call("GET", `/process/${voteId}/state`, ATHENS)).status).toBe(404);
    expect((await call("GET", "/process", ATHENS)).status).toBe(200);
    expect((await call("GET", "/feed", ATHENS)).status).toBe(200);
    const stored = await storedVote();
    expect(stored.status).toBe("active");
    expect(stored.state.status).toBe("active");
    expect(await endedEvents()).toHaveLength(0);
  });

  it("switched back on, the first read closes it, stamped with the deadline and recorded now", async () => {
    await setAthens({ "plugin.vote.enabled": "true" });
    reEnabledAt = Date.now();
    const state = await call("GET", `/process/${voteId}/state`, ATHENS);
    expect(state.status).toBe(200);
    const stored = await storedVote();
    expect(stored.status).toBe("closed");
    const ended = await endedEvents();
    expect(ended).toHaveLength(1);
    // Stamped at voting_closes_at (a minute earlier), recorded when the read ran.
    expect(Date.parse(ended[0].created_at)).toBe(Date.parse(deadline));
    expect(Date.parse(ended[0].recorded_at)).toBeGreaterThanOrEqual(reEnabledAt - 2_000);
    // So is every event the close emitted.
    const all = (await localRest(
      `events?process_id=eq.${voteId}&event_type=in.(civic.process.updated,civic.process.ended,civic.process.aggregation_completed)&select=event_type,created_at,data`,
    )) as Array<{ event_type: string; created_at: string; data: { process?: { status?: string } } }>;
    const closeEvents = all.filter((e) => e.event_type !== "civic.process.updated" || e.data.process?.status === "closed");
    expect(closeEvents.map((e) => e.event_type).sort()).toEqual(
      ["civic.process.aggregation_completed", "civic.process.ended", "civic.process.updated"],
    );
    for (const e of closeEvents) expect(Date.parse(e.created_at), e.event_type).toBe(Date.parse(deadline));
  });
});

// Phase 5 part two, fix 6: the hourly close. A vote past its deadline that
// nobody reads is closed by the `vote_close` job within the hour, stamped with
// the deadline; the job skips a hub whose Votes plugin is off (the vote then
// stays open, as above, until the plugin is back on).
describe("the hourly vote close (job vote_close)", () => {
  const CRON = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
  const deadline = new Date(Date.now() - 5 * 60_000).toISOString();
  let voteId = "";

  async function runJob(): Promise<{ status: number; body: any }> {
    return call("GET", "/internal/vote-close/run?hub=athens", ATHENS, undefined, CRON);
  }

  afterAll(async () => {
    await localRest("hub_settings?hub_id=eq.athens&key=eq.plugin.vote.enabled", { method: "DELETE" });
  });

  it("skips the hub while Votes is off, and closes the vote once it is on", async () => {
    const created = await call(
      "POST",
      "/process",
      ATHENS,
      {
        definition: { type: "civic.vote", version: "0.1" },
        title: `Hourly close ${run}`,
        description: "Nobody reads this vote after its deadline.",
        state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
      },
      athensAdmin,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    voteId = created.body.id ?? created.body.process?.id;
    expect((await call("POST", `/process/${voteId}/action`, ATHENS, { type: "process.activate", payload: {} }, athensAdmin)).status).toBe(200);
    const [row] = (await localRest(`processes?id=eq.${voteId}&select=state`)) as Array<{ state: Record<string, unknown> }>;
    await localRest(`processes?id=eq.${voteId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...row.state, voting_closes_at: deadline } }),
    });

    await setAthens({ "plugin.vote.enabled": "false" });
    const off = await runJob();
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.hubs.athens.skipped).toBe(true);
    const [still] = (await localRest(`processes?id=eq.${voteId}&select=status`)) as Array<{ status: string }>;
    expect(still.status).toBe("active");

    await setAthens({ "plugin.vote.enabled": "true" });
    const before = Date.now();
    const on = await runJob();
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.hubs.athens.closed).toContain(voteId);
    const [closed] = (await localRest(`processes?id=eq.${voteId}&select=status`)) as Array<{ status: string }>;
    expect(closed.status).toBe("closed");
    const [ended] = (await localRest(
      `events?process_id=eq.${voteId}&event_type=eq.civic.process.ended&select=created_at,recorded_at,actor`,
    )) as Array<{ created_at: string; recorded_at: string; actor: string }>;
    expect(Date.parse(ended.created_at)).toBe(Date.parse(deadline));
    expect(Date.parse(ended.recorded_at)).toBeGreaterThanOrEqual(before - 2_000);
    expect(ended.actor).toBe("system:auto-close");

    // Run again: nothing left to close.
    expect((await runJob()).body.hubs.athens.closed).not.toContain(voteId);
  });
});

// ---------------------------------------------------------------------------
// Every plugin id (2026-10-07, "plugin switches, end to end"). For each one:
// switch it on, look; switch it off, look again; put it back as it was.
//
// Fixtures are inserted straight into the local stack, one public process per
// type with a word nobody else uses in its title, so search and links have
// something to find or not. search_doc is kept by a trigger, so they are
// searchable at once. Everything inserted is deleted in afterAll.
// ---------------------------------------------------------------------------

interface PluginCase {
  id: string;
  /** A route of the plugin's that answers something other than 404 while it is on. */
  route?: { method: string; path: () => string; admin?: boolean };
  /** The scheduled job it owns (src/jobs/registry.ts). */
  job?: string;
  /** Its process types: creation, search and links are checked for each. */
  types?: string[];
  /** The admin digest section it owns (AdminDigestRunResult.counts). */
  // Briefs' section ("briefs") is walked in adminDigestQueues.test.ts: its
  // fixture here is a published brief, which search needs.
  digest?: "proposals" | "meeting_summaries" | "feedback";
}

const PLUGIN_CASES: PluginCase[] = [
  { id: "vote", route: { method: "GET", path: () => "/votes/drafts/duration-limits", admin: true }, types: ["civic.vote", "civic.vote_results"] },
  { id: "proposal", route: { method: "GET", path: () => "/proposals" }, types: ["civic.proposal"], digest: "proposals" },
  { id: "project", route: { method: "GET", path: () => "/projects" }, types: ["civic.project"] },
  { id: "announcement", route: { method: "GET", path: () => "/announcements" }, types: ["civic.announcement"] },
  { id: "brief", route: { method: "GET", path: () => "/brief" }, types: ["civic.brief"] },
  { id: "meeting_summary", route: { method: "GET", path: () => "/admin/meeting-summaries", admin: true }, job: "meeting-summary", types: ["civic.meeting_summary"], digest: "meeting_summaries" },
  { id: "wordcloud", route: { method: "GET", path: () => `/wordcloud/${athensCloud}` }, types: ["civic.wordcloud"] },
  { id: "conversation", route: { method: "GET", path: () => "/deliberations" }, types: ["civic.polis_deliberation"] },
  // Unauthenticated: 401 while on (the resident gate), 404 while off (the
  // plugin gate runs first). Only chat and suggestions are the assistant's.
  { id: "assistant", route: { method: "POST", path: () => "/assistant/civic.vote/drafts/none/message" } },
  { id: "digest", job: "digest" },
  { id: "admin_digest", job: "admin-digest" },
  { id: "search", route: { method: "GET", path: () => "/search?q=anything" } },
  { id: "feedback", route: { method: "GET", path: () => "/admin/feedback", admin: true }, digest: "feedback" },
  { id: "news_sync", job: "news-sync" },
];

const fixtureIds: string[] = [];
const fixtureLinks: string[] = [];
/** Per process type: the fixture's id, and the one word in its title. */
const fixtures = new Map<string, { id: string; word: string }>();
let anchorVote = "";
let anchorCloud = "";
let athensResident = "";

/** A fixture's state: what makes it count where the test looks. */
function fixtureState(type: string): Record<string, unknown> {
  if (type === "civic.brief") return { publication_status: "published" };
  if (type === "civic.vote_results") return { publication_status: "pending" };
  if (type === "civic.meeting_summary") return { approval_status: "pending" };
  return {};
}

async function insertFixture(type: string, word: string): Promise<string> {
  const id = `proc_plugtest_${word}`;
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id,
      hub_id: "athens",
      type,
      title: `Plugin switch fixture ${word}`,
      description: "Inserted by tests/api/pluginToggles.test.ts.",
      jurisdiction: "us-test-athens",
      status: "active",
      content: {},
      state: fixtureState(type),
      created_by: "user:civic-admin",
    }),
  });
  fixtureIds.push(id);
  return id;
}

async function linkFixture(from: string, to: string): Promise<void> {
  const id = `plink_plugtest_${fixtureLinks.length}_${run}`;
  await localRest("process_links", {
    method: "POST",
    body: JSON.stringify({ id, hub_id: "athens", from_id: from, to_id: to, relation: "references", created_by: "user:civic-admin" }),
  });
  fixtureLinks.push(id);
}

/** The anchor a type's fixture is linked from: one whose plugin stays on. */
function anchorFor(c: PluginCase): string {
  return c.id === "vote" ? anchorCloud : anchorVote;
}

async function searchFinds(word: string, id: string): Promise<{ found: boolean; total: number }> {
  const res = await call("GET", `/search?q=${word}`, ATHENS);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const hits = res.body.hits as Array<{ process_id: string }>;
  return { found: hits.some((h) => h.process_id === id), total: res.body.total };
}

async function linksOf(processId: string): Promise<{ status: number; ids: string[] }> {
  const res = await call("GET", `/process/${processId}/links`, ATHENS);
  const all = [...(res.body.outgoing ?? []), ...(res.body.incoming ?? [])] as Array<{ peer: { id: string } }>;
  return { status: res.status, ids: all.map((l) => l.peer.id) };
}

async function candidatesFor(word: string): Promise<string[]> {
  const res = await call("GET", `/process/link-candidates?q=${word}`, ATHENS, undefined, athensAdmin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.candidates as Array<{ id: string }>).map((c) => c.id);
}

async function digestCounts(): Promise<Record<string, number>> {
  const res = await call("GET", "/internal/admin-digest/run?hub=athens&force=true", ATHENS, undefined, CRON_SECRET);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.hubs.athens.counts;
}

async function routeStatus(c: PluginCase): Promise<number> {
  const r = c.route!;
  return (await call(r.method, r.path(), ATHENS, r.method === "POST" ? {} : undefined, r.admin ? athensAdmin : undefined)).status;
}

describe("every plugin, switched off on Athens", () => {
  beforeAll(async () => {
    athensResident = await mintSession("athens", `resident+plugtest${run}@example.test`);
    // The first block leaves the admin digest off on Athens until the file
    // ends; this block reads it, so it is on here and off again after.
    await setAthens({ "plugin.admin_digest.enabled": "true" });
    anchorVote = await insertFixture("civic.vote", `anchorvote${run}`);
    anchorCloud = await insertFixture("civic.wordcloud", `anchorcloud${run}`);
    for (const c of PLUGIN_CASES) {
      for (const type of c.types ?? []) {
        const word = `plugtest${run}${type.replace(/\W/g, "")}`;
        const id = await insertFixture(type, word);
        fixtures.set(type, { id, word });
        await linkFixture(anchorFor(c), id);
      }
    }
    // The digest's proposals and feedback sections read their own tables.
    const proposal = await call("POST", "/proposals", ATHENS, { title: `Plugin switch proposal ${run}`, description: "Fixture." }, athensResident);
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);
    const feedback = await call("POST", "/feedback", ATHENS, { category: "idea", message: `Plugin switch fixture ${run}` });
    expect(feedback.status, JSON.stringify(feedback.body)).toBeLessThan(300);
  });

  afterAll(async () => {
    await setAthens({ "plugin.admin_digest.enabled": "false" });
    if (fixtureLinks.length) await localRest(`process_links?id=in.(${fixtureLinks.join(",")})`, { method: "DELETE" });
    if (fixtureIds.length) await localRest(`processes?id=in.(${fixtureIds.join(",")})`, { method: "DELETE" });
  });

  it("the table covers every plugin id", () => {
    // PLUGIN_IDS, src/models/hubSettings.ts; the contract's list.
    expect(PLUGIN_CASES.map((c) => c.id).sort()).toEqual(
      ["admin_digest", "announcement", "assistant", "brief", "conversation", "digest", "feedback",
        "meeting_summary", "news_sync", "project", "proposal", "search", "vote", "wordcloud"],
    );
  });

  for (const c of PLUGIN_CASES) {
    describe(c.id, () => {
      const key = `plugin.${c.id}.enabled`;
      let storedBefore: string | undefined;
      let effectiveBefore = "true";
      const on: { route?: number; search: Record<string, boolean>; candidates: Record<string, boolean>; digest?: number } = {
        search: {},
        candidates: {},
      };

      beforeAll(async () => {
        storedBefore = await storedSetting("athens", key);
        effectiveBefore = (await athensConfig())[key] ?? "true";
        await setAthens({ [key]: "true" });
        // What it looks like while on, to compare against.
        if (c.route) on.route = await routeStatus(c);
        for (const type of c.types ?? []) {
          const f = fixtures.get(type)!;
          on.search[type] = (await searchFinds(f.word, f.id)).found;
          on.candidates[type] = (await candidatesFor(f.word)).includes(f.id);
        }
        if (c.digest) on.digest = (await digestCounts())[c.digest];
        await setAthens({ [key]: "false" });
      });

      afterAll(async () => {
        // Back as it was: the stored row if there was one, else no row.
        await setAthens({ [key]: storedBefore ?? effectiveBefore });
        if (storedBefore === undefined) {
          await localRest(`hub_settings?hub_id=eq.athens&key=eq.${key}`, { method: "DELETE" });
        }
      });

      it("the public config says it is off", async () => {
        expect((await athensConfig())[key]).toBe("false");
      });

      if (c.route) {
        it("its route answers 404 (and did not while on)", async () => {
          expect(on.route).not.toBe(404);
          expect(await routeStatus(c)).toBe(404);
        });
      }

      if (c.job) {
        it("its job is skipped for Athens", async (ctx) => {
          const res = await call("GET", `/internal/${c.job}/run?hub=athens`, ATHENS, undefined, CRON_SECRET);
          if (res.status === 200 && res.body === "disabled") return ctx.skip();
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          expect(res.body.hubs.athens).toEqual({ skipped: true, reason: `${key} is off` });
        });
      }

      for (const type of c.types ?? []) {
        it(`${type}: creation is refused`, async () => {
          const res = await call(
            "POST",
            "/process",
            ATHENS,
            { definition: { type, version: "0.1" }, title: `Refused ${run}`, description: "x", state: {} },
            athensAdmin,
          );
          expect(res.status, JSON.stringify(res.body)).toBe(404);
          expect(res.body.error).toMatch(/not available on this hub/);
        });

        it(`${type}: search leaves it out, hits and total alike`, async () => {
          const f = fixtures.get(type)!;
          expect(on.search[type]).toBe(true);
          expect(await searchFinds(f.word, f.id)).toEqual({ found: false, total: 0 });
        });

        it(`${type}: links leave it out, its own links 404, and it is no link candidate`, async () => {
          const f = fixtures.get(type)!;
          expect((await linksOf(anchorFor(c))).ids).not.toContain(f.id);
          expect((await linksOf(f.id)).status).toBe(404);
          expect(on.candidates[type]).toBe(true);
          expect(await candidatesFor(f.word)).not.toContain(f.id);
        });
      }

      if (c.types?.length) {
        it("discovery lists none of its types", async () => {
          const types = (await call("GET", "/.well-known/civic.json", ATHENS)).body.processes as string[];
          for (const type of c.types!) expect(types).not.toContain(type);
        });
      }

      if (c.digest) {
        it(`the admin digest leaves out its section (${c.digest})`, async () => {
          expect(on.digest).toBeGreaterThan(0);
          expect((await digestCounts())[c.digest!]).toBe(0);
        });
      }
    });
  }

  describe("links come back with the plugin", () => {
    it("a link to a type switched back on is rendered again", async () => {
      const f = fixtures.get("civic.project")!;
      expect((await linksOf(anchorVote)).ids).toContain(f.id);
    });
  });
});

// The Code of Conduct check is moderation, not writing help (Adam,
// 2026-10-07): with the Writing assistant off it still runs, so a draft can
// still be checked and submitted. Only the chat and the suggestions go.
describe("the Code of Conduct check with the Writing assistant off", () => {
  let draftId = "";

  beforeAll(async () => {
    const draft = await call("POST", "/votes/drafts", ATHENS, {}, athensAdmin);
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    draftId = draft.body.id;
    await setAthens({ "plugin.assistant.enabled": "false" });
  });

  afterAll(async () => {
    await setAthens({ "plugin.assistant.enabled": "true" });
    await localRest("hub_settings?hub_id=eq.athens&key=eq.plugin.assistant.enabled", { method: "DELETE" });
  });

  it("the review route answers (not 404)", async () => {
    const res = await call("POST", `/assistant/civic.vote/drafts/${draftId}/review`, ATHENS, {}, athensAdmin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.draft?.id).toBe(draftId);
  });

  it("the chat and the suggestions answer 404", async () => {
    for (const path of ["message", "suggest"]) {
      const res = await call("POST", `/assistant/civic.vote/drafts/${draftId}/${path}`, ATHENS, { message: "hi" }, athensAdmin);
      expect(res.status, path).toBe(404);
    }
  });
});

// A submission waiting for review when its plugin goes off: hidden from the
// queue and from its creator's list, and cannot be approved; back with the
// plugin, nothing lost.
describe("a pending review of a switched-off type", () => {
  let reviewId = "";
  let processId = "";

  beforeAll(async () => {
    athensResident ||= await mintSession("athens", `resident+plugtest${run}@example.test`);
    const res = await call(
      "POST",
      "/reviews/submit",
      ATHENS,
      { process_type: "civic.wordcloud", title: `Pending cloud ${run}`, description: "x", state: { prompts: [{ id: "p1", text: "One word?" }] } },
      athensResident,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    reviewId = res.body.review.id;
    processId = res.body.process_id;
    expect(res.body.review.status).toBe("pending_review");
    await setAthens({ "plugin.wordcloud.enabled": "false" });
  });

  afterAll(async () => {
    await setAthens({ "plugin.wordcloud.enabled": "true" });
    await localRest("hub_settings?hub_id=eq.athens&key=eq.plugin.wordcloud.enabled", { method: "DELETE" });
  });

  it("is gone from the admin queue and the creator's list", async () => {
    const queue = await call("GET", "/admin/reviews?status=pending_review", ATHENS, undefined, athensAdmin);
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).not.toContain(reviewId);
    const mine = await call("GET", "/reviews/mine", ATHENS, undefined, athensResident);
    expect(JSON.stringify(mine.body)).not.toContain(reviewId);
  });

  it("cannot be approved", async () => {
    const res = await call("POST", `/admin/reviews/${reviewId}/approve`, ATHENS, {}, athensAdmin);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const [row] = (await localRest(`process_reviews?id=eq.${reviewId}&select=status`)) as Array<{ status: string }>;
    expect(row.status).toBe("pending_review");
  });

  it("comes back with the plugin, and can be approved", async () => {
    await setAthens({ "plugin.wordcloud.enabled": "true" });
    const queue = await call("GET", "/admin/reviews?status=pending_review", ATHENS, undefined, athensAdmin);
    expect(JSON.stringify(queue.body)).toContain(reviewId);
    const res = await call("POST", `/admin/reviews/${reviewId}/approve`, ATHENS, {}, athensAdmin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.process_id).toBe(processId);
  });
});
