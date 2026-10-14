// The admin menu slice (2026-10-13): one sample deleted at a time, the starter
// word cloud every new hub gets, the hub's own admin log, and the personal
// review count.
//
// Through the paths an operator and an admin use: hubs made by the console's
// Create hub, Settings → Sample content (DELETE /admin/hub/sample-content/:id
// and the coded removal), Settings → Admin log. Needs the console on
// console.localhost (CI's env) and the local stack. Every hub this file
// creates is archived in afterAll.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, plantHubCode } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { STARTER_WORDCLOUD } from "../../src/services/starterWordcloud.js";

const run = Date.now().toString(36);
const DEMO = `amd-${run}`;
const BETA = `amb-${run}`;
const OFF = `amo-${run}`;
const host = (slug: string) => `${slug}.localhost`;
const ADMIN = `menu-admin-${run}@example.test`;
const created: string[] = [];
let cookie = "";

type Row = Record<string, any>;

const pid = (slug: string, key: string) => `proc_sample_${slug}_${key}`;

async function createHub(slug: string, body: Row): Promise<Row> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug, hostname: host(slug), admin_email: ADMIN, ...body },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
  return res.body;
}

const placeHub = (name: string) => ({
  name,
  jurisdiction_name: "Example County, Ohio",
  jurisdiction_custom: true,
  jurisdiction_type: "county",
});

async function strip(slug: string): Promise<string | undefined> {
  const rows = (await localRest(
    `hub_settings?select=value&hub_id=eq.${slug}&key=eq.plugin.wordcloud.onboarding_id`,
  )) as Row[];
  return rows[0]?.value;
}

async function processRow(id: string): Promise<Row | undefined> {
  return ((await localRest(`processes?select=id,type,status,title,is_sample,state&id=eq.${id}`)) as Row[])[0];
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  await createHub(DEMO, { ...placeHub("Menu Demo Civic Hub"), sample_content: true });
  await createHub(BETA, { ...placeHub("Menu Beta Civic Hub"), mode: "beta" });
  await createHub(OFF, { ...placeHub("Menu Off Civic Hub"), mode: "beta", plugins: { wordcloud: false } });
});

afterAll(async () => {
  for (const id of created) {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantCode("step_up", code);
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: code } });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

describe("the starter word cloud", () => {
  it("a hub made without samples starts with an open, real word cloud in its strip, with a prompt that names no place", async () => {
    const id = await strip(BETA);
    expect(id).toBeTruthy();
    const p = await processRow(id!);
    expect(p).toMatchObject({ type: "civic.wordcloud", status: "active", is_sample: false, title: STARTER_WORDCLOUD.title });
    expect(p!.state.prompts[0].text).toBe(STARTER_WORDCLOUD.prompt);
    expect(p!.state.prompts[0].text).not.toMatch(/Example|Ohio|County/);
    // Its creation and opening are events like any other process's.
    const events = (await localRest(`events?select=event_type&process_id=eq.${id}`)) as Row[];
    expect(events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(["civic.process.created", "civic.process.started"]),
    );
    const log = (await localRest(`hub_admin_audit_log?select=action&hub_id=eq.${BETA}`)) as Row[];
    expect(log.map((r) => r.action)).toContain("wordcloud.starter");
  });

  it("a hub made with samples shows the sample word cloud, not the starter", async () => {
    expect(await strip(DEMO)).toBe(pid(DEMO, "wordcloud_value"));
    const real = (await localRest(`processes?select=id&hub_id=eq.${DEMO}&type=eq.civic.wordcloud&is_sample=eq.false`)) as Row[];
    expect(real).toHaveLength(0);
  });

  it("a hub with Word clouds off gets none", async () => {
    expect(await strip(OFF)).toBeFalsy();
    const any = (await localRest(`processes?select=id&hub_id=eq.${OFF}&type=eq.civic.wordcloud`)) as Row[];
    expect(any).toHaveLength(0);
  });
});

describe("deleting one sample", () => {
  let admin = "";
  beforeAll(async () => {
    admin = await mintSession(DEMO, ADMIN);
  });

  it("lists each deletable sample with its page; a closed vote's brief goes with its vote, not on its own", async () => {
    const res = await call("GET", "/admin/hub/sample-content", host(DEMO), undefined, admin);
    expect(res.status).toBe(200);
    const ids = (res.body.items as Row[]).map((i) => i.id);
    expect(ids).toContain(pid(DEMO, "vote_library_hours"));
    expect(ids).not.toContain(pid(DEMO, "outcome_library_hours"));
    const vote = (res.body.items as Row[]).find((i) => i.id === pid(DEMO, "vote_library_hours"))!;
    expect(vote.path).toMatch(/proc_sample_/);
  });

  it("deletes a sample vote with its brief and what people added, without a code, and records it", async () => {
    const vote = pid(DEMO, "vote_library_hours");
    const brief = pid(DEMO, "outcome_library_hours");
    expect(await processRow(brief)).toBeTruthy();
    const res = await call("DELETE", `/admin/hub/sample-content/${vote}`, host(DEMO), undefined, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deleted).toMatchObject({ id: vote });
    expect(await processRow(vote)).toBeUndefined();
    expect(await processRow(brief)).toBeUndefined();
    expect((await localRest(`events?select=id&process_id=eq.${vote}`)) as Row[]).toHaveLength(0);
    expect((res.body.summary.items as Row[]).some((i) => i.id === vote)).toBe(false);

    const log = await call("GET", "/admin/hub/admin-log", host(DEMO), undefined, admin);
    expect(log.status).toBe(200);
    const row = (log.body.entries as Row[]).find((e) => e.action === "sample_content.delete_one");
    expect(row?.before).toMatchObject({ id: vote, with: [brief] });
    expect(row?.actor_email).toBe(ADMIN);
  });

  it("refuses a real process (404), and leaves it alone", async () => {
    const real = await strip(BETA);
    const beta = await mintSession(BETA, ADMIN);
    const res = await call("DELETE", `/admin/hub/sample-content/${real}`, host(BETA), undefined, beta);
    expect(res.status).toBe(404);
    expect(await processRow(real!)).toBeTruthy();
  });

  it("is for admins only", async () => {
    const resident = await mintSession(DEMO, `menu-resident-${run}@example.test`);
    const target = pid(DEMO, "vote_internet");
    expect((await call("DELETE", `/admin/hub/sample-content/${target}`, host(DEMO), undefined, resident)).status).toBe(403);
    expect((await call("GET", "/admin/hub/admin-log", host(DEMO), undefined, resident)).status).toBe(403);
    expect(await processRow(target)).toBeTruthy();
  });

  it("deleting the sample word cloud puts the starter in the strip, real content", async () => {
    const cloud = pid(DEMO, "wordcloud_value");
    const res = await call("DELETE", `/admin/hub/sample-content/${cloud}`, host(DEMO), undefined, admin);
    expect(res.status).toBe(200);
    expect(res.body.cleared).toEqual(["plugin.wordcloud.onboarding_id"]);
    const id = await strip(DEMO);
    expect(id).toBeTruthy();
    expect(id).not.toBe(cloud);
    expect(await processRow(id!)).toMatchObject({ is_sample: false, status: "active", title: STARTER_WORDCLOUD.title });
  });

  it("removing every sample leaves no seeded sample, and the starter in place", async () => {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await plantHubCode(DEMO, ADMIN, code);
    const before = await strip(DEMO);
    const res = await call("POST", "/admin/hub/sample-content/remove", host(DEMO), { code }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.summary.processes).toBe(0);
    expect(res.body.summary.items).toEqual([]);
    // The starter is real content: it stays, still chosen.
    expect(await strip(DEMO)).toBe(before);
    expect(await processRow(before!)).toBeTruthy();
    const flags = await call("GET", "/hub-config", host(DEMO));
    expect(flags.body.content?.samples).toBe(false);
  });
});

describe("the account menu is personal", () => {
  it("an admin's own review count leaves out the admin queue", async () => {
    const admin = await mintSession(BETA, ADMIN);
    const queue = await call("GET", "/notifications/reviews/count", host(BETA), undefined, admin);
    const mine = await call("GET", "/notifications/reviews/count?scope=mine", host(BETA), undefined, admin);
    expect(queue.status).toBe(200);
    expect(mine.status).toBe(200);
    expect(mine.body.count).toBe(0);
  });
});
