// The sample-content seed (Phase 7), through the console's Create hub with
// "Start with sample content" on — the path an operator uses.
//
// A county hub in Virginia gets all eleven templates, the governing body the
// form infers ("Board of Supervisors") and its short form ("Supervisors"),
// its names filled in, every event
// marked sample and none of it on GET /events; a school district gets its
// own set (2026-10-07). Then the county hub's admin removes it all and the hub
// still serves, empty. (Idempotence is the script's, and is checked by hand
// in the HANDOFF: the console seeds a hub once, at creation.)
//
// Plugin switches do not decide what is seeded (Adam, 2026-09-27): a hub
// created with Conversations off still gets the sample conversation, hidden
// until Conversations is turned on.
//
// Needs the console on console.localhost (CI's env) and the local stack.
// Every hub this file creates is archived in afterAll, like control.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { auditFor, consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const COUNTY = `smpc-${run}`;
const SCHOOLS = `smps-${run}`;
const NOCONV = `smpn-${run}`;
const host = (slug: string) => `${slug}.localhost`;
const ADMIN = `sample-admin-${run}@example.test`;
const created: string[] = [];
let cookie = "";

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
});

afterAll(async () => {
  for (const id of created) {
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: await stepCode() } });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

type Row = Record<string, any>;

describe("a county hub created with sample content", () => {
  let body: Row = {};

  beforeAll(async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: {
        slug: COUNTY,
        name: "Sample Test Civic Hub",
        hostname: host(COUNTY),
        // A real Virginia county from the loaded list (its OCD id gives the
        // state, hence "Board of Supervisors"), shown under a test name.
        jurisdiction_ocd_id: "ocd-division/country:us/state:va/county:floyd",
        jurisdiction_name: "Example County, Virginia",
        jurisdiction_type: "county",
        admin_email: ADMIN,
        sample_content: true,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(COUNTY);
    body = res.body;
  });

  it("infers the governing body from the type and the state, and stores the type", async () => {
    expect(body.config.governing_body).toBe("Board of Supervisors");
    expect(body.config.governing_body_short).toBe("Supervisors");
    expect(body.config.jurisdiction_type).toBe("county");
  });

  it("seeds all eleven templates, marked sample, by five sample authors", async () => {
    expect(body.sample_content.created).toHaveLength(11);
    const procs = (await localRest(`processes?select=id,is_sample,title,description&hub_id=eq.${COUNTY}`)) as Row[];
    expect(procs).toHaveLength(11);
    expect(procs.every((p) => p.is_sample === true)).toBe(true);
    const users = (await localRest(`users?select=id,full_name&hub_id=eq.${COUNTY}&is_sample=is.true`)) as Row[];
    expect(users).toHaveLength(5);
    expect(users.map((u) => u.full_name)).toContain("Sample Test Civic Hub team");
  });

  it("fills the hub's own names in, and no placeholder is left", async () => {
    const procs = (await localRest(`processes?select=title,description&hub_id=eq.${COUNTY}`)) as Row[];
    const text = procs.map((p) => `${p.title} ${p.description}`).join("\n");
    expect(text).not.toMatch(/\{[A-Z_]+\}/);
    expect(text).toContain("Example County"); // the place, without its state
    expect(text).not.toContain("Example County, Virginia");
    expect(text).toContain("Board of Supervisors");
  });

  it("puts the open vote's deadline ahead and the closed vote's behind", async () => {
    const [open] = (await localRest(`processes?select=state&id=eq.proc_sample_${COUNTY}_vote_internet`)) as Row[];
    expect(new Date(open.state.voting_closes_at).getTime()).toBeGreaterThan(Date.now());
    expect(open.state.status).toBe("active");
    expect(open.state.method).toBe("yes_no_unsure"); // single choice: "Pick one"
    const [closed] = (await localRest(`processes?select=status&id=eq.proc_sample_${COUNTY}_vote_library_hours`)) as Row[];
    expect(closed.status).toBe("finalized");
  });

  it("edits the short form from the hub page, and the hub serves it", async () => {
    const res = await consoleCall("PATCH", `/control/hubs/${COUNTY}`, { cookie, body: { governing_body_short: "Board" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.governing_body_short).toBe("Board");
    const config = await call("GET", "/hub-config", host(COUNTY));
    expect(config.body.settings["copy.governing_body_short"]).toBe("Board");
    await consoleCall("PATCH", `/control/hubs/${COUNTY}`, { cookie, body: { governing_body_short: "Supervisors" } });
  });

  it("publishes the sample meeting summary, saying it is a sample, with times and no recording", async () => {
    const id = `proc_sample_${COUNTY}_meeting_summary_regular`;
    const res = await call("GET", `/meeting-summary/${id}`, host(COUNTY));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.is_sample).toBe(true);
    expect(res.body.meeting_title).toBe("Board of Supervisors regular meeting");
    expect(res.body.source_video_url).toBeNull();
    expect(res.body.blocks).toHaveLength(4);
    expect(res.body.blocks.every((b: Row) => typeof b.start_time_seconds === "number")).toBe(true);
    const [row] = (await localRest(`processes?select=status&id=eq.${id}`)) as Row[];
    expect(row.status).toBe("finalized");
  });

  it("opens the sample word cloud with its answers, and makes it the hub's word cloud", async () => {
    const id = `proc_sample_${COUNTY}_wordcloud_value`;
    const subs = (await localRest(`wordcloud_submissions?select=body,author_id&process_id=eq.${id}`)) as Row[];
    expect(subs).toHaveLength(32);
    expect(subs.every((r) => r.author_id === null)).toBe(true);
    const [setting] = (await localRest(`hub_settings?select=value&hub_id=eq.${COUNTY}&key=eq.plugin.wordcloud.onboarding_id`)) as Row[];
    expect(setting?.value).toBe(id);
    const config = await call("GET", "/hub-config", host(COUNTY));
    expect(config.body.settings["plugin.wordcloud.onboarding_id"]).toBe(id);
  });

  it("gives the sample conversation the default Polis address when the hub names none", async () => {
    const [row] = (await localRest(`processes?select=state&id=eq.proc_sample_${COUNTY}_deliberation_rentals`)) as Row[];
    expect(row.state.polis_base_url).toBe("https://polis.civic.social/seed-sample-deliberation_rentals");
  });

  it("marks every event sample, and serves none on GET /events", async () => {
    const events = (await localRest(`events?select=is_sample&hub_id=eq.${COUNTY}`)) as Row[];
    expect(events.length).toBeGreaterThan(20);
    expect(events.every((e) => e.is_sample === true)).toBe(true);
    const wire = await call("GET", "/events?page=true", host(COUNTY));
    expect(wire.status).toBe(200);
    expect(wire.body.totalItems ?? wire.body.orderedItems?.length ?? 0).toBe(0);
  });

  it("shows them in the hub's own feed, marked sample", async () => {
    const feed = await call("GET", "/api/feed", host(COUNTY));
    expect(feed.status).toBe(200);
    expect(feed.body.events.length).toBeGreaterThan(0);
    expect(feed.body.events.every((e: Row) => e.sample === true)).toBe(true);
  });

  it("records the seed in the console's audit trail", async () => {
    const audit = await auditFor(COUNTY);
    expect(audit.map((a) => a.action)).toContain("hub.sample_seed");
  });

  it("comes out in one audited action, leaving a hub that still serves", async () => {
    const admin = await mintSession(COUNTY, ADMIN);
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await localRest("pending_verifications", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ hub_id: COUNTY, email: ADMIN, code, expires_at: new Date(Date.now() + 600_000).toISOString(), attempts: 0 }),
    });
    const before = await call("GET", "/admin/hub/sample-content", host(COUNTY), undefined, admin);
    expect(before.body).toMatchObject({ processes: 11, other_processes: 0, real_input_total: 0 });

    const res = await call("POST", "/admin/hub/sample-content/remove", host(COUNTY), { code }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await localRest(`processes?select=id&hub_id=eq.${COUNTY}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`events?select=id&hub_id=eq.${COUNTY}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`vote_records?select=receipt_id&hub_id=eq.${COUNTY}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`community_inputs?select=id&hub_id=eq.${COUNTY}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`users?select=id&hub_id=eq.${COUNTY}&is_sample=is.true`)) as Row[]).toHaveLength(0);
    expect((await localRest(`wordcloud_submissions?select=id&hub_id=eq.${COUNTY}`)) as Row[]).toHaveLength(0);
    // The hub's word cloud pointed at the sample; it points at nothing now.
    const [cleared] = (await localRest(`hub_settings?select=value&hub_id=eq.${COUNTY}&key=eq.plugin.wordcloud.onboarding_id`)) as Row[];
    expect(cleared?.value ?? "").toBe("");

    const feed = await call("GET", "/api/feed", host(COUNTY));
    expect(feed.status).toBe(200);
    expect(feed.body.events).toHaveLength(0);
    expect((await call("GET", "/process", host(COUNTY))).status).toBe(200);

    const log = await consoleCall("GET", `/control/hubs/${COUNTY}/admin-audit`, { cookie });
    expect(log.status).toBe(200);
    expect(log.body.entries[0]).toMatchObject({ action: "sample_content.remove", actor_email: ADMIN });
  });
});

describe("a school district hub", () => {
  it("gets only the templates that fit, and a School Board", async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: {
        slug: SCHOOLS,
        name: "Sample Schools Civic Hub",
        hostname: host(SCHOOLS),
        jurisdiction_name: "Example Schools, Ohio",
        jurisdiction_custom: true,
        jurisdiction_type: "school_district",
        admin_email: ADMIN,
        sample_content: true,
        timezone: "America/New_York",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(SCHOOLS);
    // The create form's time zone (2026-10-06) is the hub's identity.timezone.
    const [tz] = (await localRest(`hub_settings?select=value&hub_id=eq.${SCHOOLS}&key=eq.identity.timezone`)) as Row[];
    expect(tz?.value).toBe("America/New_York");
    expect(res.body.config.governing_body).toBe("School Board");
    expect(res.body.config.governing_body_short).toBe("School Board");
    // Its own set (2026-10-07, review R18) and the budget hearing.
    const keys: string[] = res.body.sample_content.created;
    expect(keys).toHaveLength(11);
    expect(keys.filter((k) => !k.startsWith("sd_"))).toEqual(["announcement_budget_hearing"]);
    const procs = (await localRest(`processes?select=title,description&hub_id=eq.${SCHOOLS}`)) as Row[];
    const text = procs.map((p) => `${p.title} ${p.description}`).join("\n");
    expect(text).not.toMatch(/\{[A-Z_]+\}/);
    expect(text).not.toMatch(/library|road|land use/i);
  });
});

describe("a time zone that is not one", () => {
  it("is refused at create, and no hub is made", async () => {
    const slug = `smpt-${run}`;
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: { slug, name: "Bad Zone Hub", hostname: host(slug), hub_kind: "other", admin_email: ADMIN, timezone: "Mars/Olympus" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a time zone/);
    expect((await localRest(`hubs?select=id&id=eq.${slug}`)) as Row[]).toHaveLength(0);
  });
});

describe("a hub created with Conversations off", () => {
  const convId = `proc_sample_${NOCONV}_deliberation_rentals`;

  beforeAll(async () => {
    const res = await consoleCall("POST", "/control/hubs", {
      cookie,
      body: {
        slug: NOCONV,
        name: "Sample No-Conversation Civic Hub",
        hostname: host(NOCONV),
        jurisdiction_name: "Example County, Virginia",
        jurisdiction_custom: true,
        jurisdiction_type: "county",
        admin_email: ADMIN,
        sample_content: true,
        plugins: { conversation: false },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(NOCONV);
    expect(res.body.plugins.find((p: Row) => p.id === "conversation")).toMatchObject({ enabled: false, source: "hub" });
    expect(res.body.plugins.filter((p: Row) => p.enabled)).toHaveLength(res.body.plugins.length - 1);
    expect(res.body.sample_content.created).toContain("deliberation_rentals");
  });

  it("seeds every template the type allows, the conversation included", async () => {
    const procs = (await localRest(`processes?select=id,is_sample&hub_id=eq.${NOCONV}`)) as Row[];
    expect(procs).toHaveLength(11);
    expect(procs.map((p) => p.id)).toContain(convId);
  });

  it("hides the sample conversation while Conversations is off", async () => {
    expect((await call("GET", `/process/${convId}`, host(NOCONV))).status).toBe(404);
    expect((await call("GET", "/deliberations", host(NOCONV))).status).toBe(404);
    const feed = await call("GET", "/api/feed", host(NOCONV));
    expect(feed.status).toBe(200);
    expect(feed.body.events.some((e: Row) => e.process_id === convId)).toBe(false);
    expect(feed.body.events.length).toBeGreaterThan(0); // the rest is there
  });

  it("shows it once Conversations is turned on", async () => {
    const res = await consoleCall("PUT", `/control/hubs/${NOCONV}/plugins`, { cookie, body: { plugins: { conversation: true } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await call("GET", `/process/${convId}`, host(NOCONV))).status).toBe(200);
    const list = await call("GET", "/deliberations", host(NOCONV));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(convId);
    const feed = await call("GET", "/api/feed", host(NOCONV));
    expect(feed.body.events.some((e: Row) => e.process_id === convId)).toBe(true);
  });

  it("comes out with the rest when sample content is removed, even with Conversations off again", async () => {
    await consoleCall("PUT", `/control/hubs/${NOCONV}/plugins`, { cookie, body: { plugins: { conversation: false } } });
    const admin = await mintSession(NOCONV, ADMIN);
    const code = String(100000 + Math.floor(Math.random() * 899999));
    await localRest("pending_verifications", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ hub_id: NOCONV, email: ADMIN, code, expires_at: new Date(Date.now() + 600_000).toISOString(), attempts: 0 }),
    });
    const res = await call("POST", "/admin/hub/sample-content/remove", host(NOCONV), { code }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await localRest(`processes?select=id&hub_id=eq.${NOCONV}`)) as Row[]).toHaveLength(0);
    expect((await localRest(`events?select=id&hub_id=eq.${NOCONV}`)) as Row[]).toHaveLength(0);
  });
});
