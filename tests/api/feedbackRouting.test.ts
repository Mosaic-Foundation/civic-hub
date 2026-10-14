// Feedback routing (2026-10-15): feedback about a hub's community stays with
// the hub; feedback about the software also reaches Civic.Social, the sender
// told so, and the loop closes.
//
// Through the paths people use: POST /feedback (the form), Admin → Feedback
// (GET /admin/feedback, POST /admin/feedback/:id/forward), Contact
// Civic.Social (POST /admin/contact-civic-social), and the console's inbox
// (GET and PATCH /control/feedback). Hubs are made by the console's Create
// hub and archived in afterAll. Needs the console on console.localhost and
// the local stack.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { freshTestIp } from "../fixtures/helpers.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const run = Date.now().toString(36);
const HUB = `fbr-${run}`;
const OFF = `fbo-${run}`;
const host = (slug: string) => `${slug}.localhost`;
const ADMIN = `fb-admin-${run}@example.test`;
const RESIDENT = `fb-resident-${run}@example.test`;
const created: string[] = [];
let cookie = "";
let admin = "";
let resident = "";

type Row = Record<string, any>;

async function createHub(slug: string, body: Row): Promise<void> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: {
      slug,
      hostname: host(slug),
      admin_email: ADMIN,
      jurisdiction_name: "Example County, Ohio",
      jurisdiction_custom: true,
      jurisdiction_type: "county",
      mode: "beta",
      ...body,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(slug);
}

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FeedbackRoutingTest";

async function send(body: Row, token?: string, slug = HUB) {
  const res = await call("POST", "/feedback", host(slug), body, token, freshTestIp(), { "User-Agent": BROWSER });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { submission_id: string; shared_with_civic_social: boolean };
}

async function hubRow(id: string): Promise<Row> {
  return ((await localRest(`feedback_submissions?select=*&id=eq.${id}`)) as Row[])[0];
}

async function inbox(query = ""): Promise<Row[]> {
  const res = await consoleCall("GET", `/control/feedback${query}`, { cookie });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.groups as Row[][]).flat();
}

async function copyOf(sourceId: string): Promise<Row | undefined> {
  return (await inbox()).find((i) => i.source_feedback_id === sourceId);
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
  await createHub(HUB, { name: "Routing Test Civic Hub" });
  await createHub(OFF, { name: "Routing Off Civic Hub", plugins: { feedback: false } });
  admin = await mintSession(HUB, ADMIN);
  resident = await mintSession(HUB, RESIDENT);
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

describe("a software report", () => {
  it("lands with the hub and in the console inbox, with page, browser, version and the consenting sender's address", async () => {
    const sent = await send(
      { category: "bug", message: `The ballot jumps when I scroll ${run}`, page_path: "/vote/v_1?code=1#top", contact_ok: true },
      resident,
    );
    expect(sent.shared_with_civic_social).toBe(true);

    const row = await hubRow(sent.submission_id);
    expect(row).toMatchObject({
      hub_id: HUB,
      category: "bug",
      page_path: "/vote/v_1",
      contact_ok: true,
      mosaic_stream: "bug",
      mosaic_status: "received",
      mosaic_sent_by: "sender",
    });
    expect(row.software_version).toBeTruthy();

    const copy = await copyOf(sent.submission_id);
    expect(copy).toMatchObject({
      source_hub_id: HUB,
      hub_name: "Routing Test Civic Hub",
      stream: "bug",
      origin: "resident",
      page_path: "/vote/v_1",
      contact_ok: true,
      contact_email: RESIDENT,
      status: "received",
    });
    expect(copy!.user_agent).toBe(BROWSER);
    expect(copy!.software_version).toBe(row.software_version);
  });

  it("an item without consent reaches the console with no email address", async () => {
    // Anonymous, with an address typed in, consent not ticked.
    const a = await send({ category: "idea", message: `A calendar export would help ${run}`, email: `anon-${run}@example.test` });
    // Signed in, consent not ticked.
    const b = await send({ category: "bug", message: `Search shows nothing ${run}` }, resident);
    // Consent ticked with no address to share means no consent.
    const c = await send({ category: "idea", message: `Dark mode please ${run}`, contact_ok: true });

    for (const id of [a.submission_id, b.submission_id, c.submission_id]) {
      const copy = await copyOf(id);
      expect(copy, id).toBeDefined();
      expect(copy!.contact_ok).toBe(false);
      expect(copy!.contact_email).toBeNull();
      expect(JSON.stringify(copy)).not.toContain("@example.test");
    }
    expect((await copyOf(a.submission_id))!.stream).toBe("feature");
    // The hub keeps the address it was given, as before.
    expect((await hubRow(a.submission_id)).email).toBe(`anon-${run}@example.test`);
  });

  it("the database refuses an address without consent", async () => {
    await expect(
      localRest("platform_feedback", {
        method: "POST",
        body: JSON.stringify({
          id: `pf_refuse_${run}`,
          source_hub_id: HUB,
          stream: "bug",
          origin: "resident",
          message: "x",
          contact_ok: false,
          contact_email: "someone@example.test",
        }),
      }),
    ).rejects.toThrow(/platform_feedback 400/);
    const rows = (await localRest(`platform_feedback?select=id&id=eq.pf_refuse_${run}`)) as Row[];
    expect(rows).toHaveLength(0);
  });
});

describe("a hub report", () => {
  it("lands with the hub only", async () => {
    for (const category of ["topic", "moderation", "general"]) {
      const sent = await send({ category, message: `About our park, ${category} ${run}`, contact_ok: true }, resident);
      expect(sent.shared_with_civic_social).toBe(false);
      const row = await hubRow(sent.submission_id);
      expect(row.mosaic_item_id).toBeNull();
      expect(await copyOf(sent.submission_id)).toBeUndefined();
    }
  });
});

describe("Admin → Feedback", () => {
  let general = "";
  let consenting = "";

  beforeAll(async () => {
    general = (await send({ category: "general", message: `The page froze on submit ${run}`, page_path: "/propose" }, resident))
      .submission_id;
    consenting = (await send({ category: "moderation", message: `Misfiled crash ${run}`, contact_ok: true }, resident))
      .submission_id;
  });

  it("shows the badge with Civic.Social's status on shared items, and none on the hub's own", async () => {
    const res = await call("GET", "/admin/feedback", host(HUB), undefined, admin);
    expect(res.status).toBe(200);
    const items = res.body.items as Row[];
    const bug = items.find((i) => i.category === "bug");
    expect(bug!.mosaic).toMatchObject({ stream: "bug", status: "received", sent_by: "sender" });
    expect(items.find((i) => i.id === general)!.mosaic).toBeNull();
  });

  it("an admin forwards a misfiled item once, in the stream they pick, without the sender's address", async () => {
    const res = await call("POST", `/admin/feedback/${consenting}/forward`, host(HUB), { stream: "bug" }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.item.mosaic).toMatchObject({ stream: "bug", status: "received", sent_by: "admin" });

    const copy = await copyOf(consenting);
    expect(copy).toMatchObject({ origin: "forwarded", stream: "bug", contact_ok: false, contact_email: null });

    const again = await call("POST", `/admin/feedback/${consenting}/forward`, host(HUB), { stream: "feature" }, admin);
    expect(again.status).toBe(409);

    const log = (await localRest(`hub_admin_audit_log?select=action,actor_email,after&hub_id=eq.${HUB}&action=eq.feedback.forward`)) as Row[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_email: ADMIN, after: { id: consenting, stream: "bug" } });
  });

  it("refuses a resident, a bad stream and an unknown item", async () => {
    expect((await call("POST", `/admin/feedback/${general}/forward`, host(HUB), { stream: "bug" }, resident)).status).toBe(403);
    expect((await call("POST", `/admin/feedback/${general}/forward`, host(HUB), { stream: "admin" }, admin)).status).toBe(400);
    expect((await call("POST", `/admin/feedback/fb_nope_${run}/forward`, host(HUB), { stream: "bug" }, admin)).status).toBe(404);
  });

  it("a hub cannot read Civic.Social's inbox", async () => {
    for (const token of [admin, resident, undefined]) {
      const res = await call("GET", "/control/feedback", host(HUB), undefined, token);
      expect(res.status).toBe(404);
    }
  });
});

describe("Civic.Social's status flows back", () => {
  let id = "";
  let copyId = "";

  beforeAll(async () => {
    id = (await send({ category: "bug", message: `Receipt download fails ${run}`, page_path: "/vote/v_9", contact_ok: true }, resident))
      .submission_id;
    copyId = (await copyOf(id))!.id;
  });

  it("planned shows on the hub's badge; the issue link stays in the console", async () => {
    const res = await consoleCall("PATCH", `/control/feedback/${copyId}`, {
      cookie,
      body: { status: "planned", github_issue_url: "https://github.com/Mosaic-Foundation/civic-hub/issues/1" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await hubRow(id)).mosaic_status).toBe("planned");
    const admins = await call("GET", "/admin/feedback", host(HUB), undefined, admin);
    const item = (admins.body.items as Row[]).find((i) => i.id === id)!;
    expect(item.mosaic.status).toBe("planned");
    expect(JSON.stringify(item)).not.toContain("github.com");
  });

  it("fixed tells a consenting sender once (held back on a beta hub), and is audited without their address", async () => {
    const first = await consoleCall("PATCH", `/control/feedback/${copyId}`, { cookie, body: { status: "fixed" } });
    expect(first.status).toBe(200);
    expect(first.body.sender_told).toBeDefined();
    expect((await hubRow(id)).mosaic_status).toBe("fixed");
    const stored = ((await localRest(`platform_feedback?select=fixed_notified_at&id=eq.${copyId}`)) as Row[])[0];
    expect(stored.fixed_notified_at).toBeTruthy();

    await consoleCall("PATCH", `/control/feedback/${copyId}`, { cookie, body: { status: "planned" } });
    const second = await consoleCall("PATCH", `/control/feedback/${copyId}`, { cookie, body: { status: "fixed" } });
    expect(second.body.sender_told).toBeUndefined();

    const audit = (await localRest(
      `control_audit_log?select=action,after&target_hub_id=eq.${HUB}&action=eq.feedback.update`,
    )) as Row[];
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audit)).not.toContain(RESIDENT);
  });

  it("refuses a bad status or a link that is not GitHub's", async () => {
    expect((await consoleCall("PATCH", `/control/feedback/${copyId}`, { cookie, body: { status: "closed" } })).status).toBe(400);
    expect(
      (await consoleCall("PATCH", `/control/feedback/${copyId}`, { cookie, body: { github_issue_url: "https://example.com/1" } })).status,
    ).toBe(400);
    expect((await consoleCall("PATCH", `/control/feedback/pf_nope_${run}`, { cookie, body: { status: "fixed" } })).status).toBe(404);
  });
});

describe("the inbox", () => {
  it("groups likely duplicates: same page, similar text", async () => {
    const a = await send({ category: "bug", message: `Map tiles stay blank on the projects map ${run}`, page_path: "/projects/map" });
    const b = await send({ category: "bug", message: `The projects map tiles stay blank ${run}`, page_path: "/projects/map" });
    const res = await consoleCall("GET", "/control/feedback?stream=bug", { cookie });
    const group = (res.body.groups as Row[][]).find((g) => g.some((i) => i.source_feedback_id === a.submission_id))!;
    expect(group.map((i) => i.source_feedback_id)).toEqual(expect.arrayContaining([a.submission_id, b.submission_id]));
    expect(res.body.received).toBeGreaterThan(0);
  });

  it("needs the console's session", async () => {
    expect((await consoleCall("GET", "/control/feedback")).status).toBe(401);
  });
});

describe("Contact Civic.Social", () => {
  it("an admin writes to Civic.Social directly, with their address; it is not on the hub's Feedback tab", async () => {
    const res = await call("POST", "/admin/contact-civic-social", host(HUB), { message: `Can we move our hub's address? ${run}` }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const copy = (await inbox("?stream=admin")).find((i) => i.id === res.body.id);
    expect(copy).toMatchObject({ stream: "admin", origin: "admin", contact_ok: true, contact_email: ADMIN, source_feedback_id: null });
    const tab = await call("GET", "/admin/feedback", host(HUB), undefined, admin);
    expect(JSON.stringify(tab.body)).not.toContain("move our hub's address");
  });

  it("works with the Feedback plugin off, and only for admins", async () => {
    const offAdmin = await mintSession(OFF, ADMIN);
    expect((await call("POST", "/admin/contact-civic-social", host(OFF), { message: `Hello ${run}` }, offAdmin)).status).toBe(200);
    expect((await call("GET", "/admin/feedback", host(OFF), undefined, offAdmin)).status).toBe(404);
    expect((await call("POST", "/admin/contact-civic-social", host(HUB), { message: "x" }, resident)).status).toBe(403);
    expect((await call("POST", "/admin/contact-civic-social", host(HUB), { message: " " }, admin)).status).toBe(400);
  });
});
