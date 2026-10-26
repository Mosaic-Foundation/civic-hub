// Plugin packages on a hub (plugin session 1, ADR-014), through the API:
//   - a new hub gets every approved package installed, and the Plugins page's
//     list says what each may do, in plain words;
//   - Install, Remove → Stop now (today's switch-off: routes 404, the item kept,
//     everything back on Install), Remove → Wind down (nothing new can be
//     started, what is open runs to its close, the close job switches it off),
//     each recorded in hub_plugins and the admin log;
//   - the console's catalog: list, approve and withdraw behind a fresh code and
//     audited; a withdrawn package stops being mounted, and a hub never sees a
//     package the catalog has not approved;
//   - /health lists what is not mounted and stays ok; civic.json lists the
//     installed packages with their versions;
//   - signed approvals (plugin session 2, ADR-015): a row whose signature is
//     missing or does not verify is unapproved once signatures are required,
//     and "Sign approved entries" signs it again, behind a fresh code, audited.
// On a hub the console creates for this file (archived in afterAll). Local
// stack only (pg for the install records). Needs a server (CIVIC_API_BASE)
// with CIVIC_FAKE_ADAPTERS on.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`pluginPackages: refusing ${host}; local stack only.`);
}
const CRON = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
const run = Date.now().toString(36);
const SLUG = `pkg-${run}`;
const HOST = `${SLUG}.localhost`;
const ADMIN = `pkg-admin-${run}@example.test`;
const WORDCLOUD = "@civic-social/plugin-wordcloud";

let db: pg.Client;
let cookie = "";
let admin = "";
let resident = "";

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

const installs = async () => {
  const res = await call("GET", "/admin/hub/plugins/installs", HOST, undefined, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.plugins as Array<{
    plugin: string;
    state: string;
    open: number;
    wind_down_offered: boolean;
    update_available: boolean;
    packages: Array<{ package: string; version: string; grant: { can: string[]; cannot: string[] } }>;
  }>;
};
const one = async (plugin: string) => (await installs()).find((p) => p.plugin === plugin)!;

async function record(pkg: string) {
  return (
    await db.query<{ version: string; removed_at: string | null; removed_by: string | null; winding_down_since: string | null; installed_by: string }>(
      "SELECT version, removed_at, removed_by, winding_down_since, installed_by FROM hub_plugins WHERE hub_id = $1 AND package = $2",
      [SLUG, pkg],
    )
  ).rows[0];
}

async function createCloud(): Promise<{ status: number; body: any }> {
  return call("POST", "/process", HOST, {
    definition: { type: "civic.wordcloud", version: "0.1" },
    title: `Cloud ${run}`,
    description: "One word.",
    state: { prompts: [{ id: "p1", text: "One word?" }] },
  }, admin);
}

async function createVote(title: string): Promise<{ status: number; body: any }> {
  return call("POST", "/process", HOST, {
    definition: { type: "civic.vote", version: "0.1" },
    title,
    description: "Should the hub try this?",
    state: { config: { activation_mode: "direct" } },
  }, admin);
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug: SLUG, name: "Plugin Packages Hub", hostname: HOST, admin_email: ADMIN, hub_kind: "organization" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  admin = await mintSession(SLUG, ADMIN);
  resident = await mintSession(SLUG, `pkg-resident-${run}@example.test`);
});

afterAll(async () => {
  await consoleCall("POST", `/control/hubs/${SLUG}/archive`, { cookie, body: { step_up_code: await stepCode() } });
  await db.end();
});

describe("a hub's plugin packages", () => {
  it("a new hub has every approved package installed, recorded with its version and grant", async () => {
    const list = await installs();
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const p of list) expect(p.state, p.plugin).toBe("installed");
    const rows = (await db.query("SELECT package, installed_by, capabilities FROM hub_plugins WHERE hub_id = $1", [SLUG])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.installed_by).toBe("system:hub-created");
    const cloud = (await one("wordcloud")).packages[0];
    expect(cloud.package).toBe(WORDCLOUD);
    expect(cloud.grant.can[0]).toContain("Keep its own records on this hub: residents' one-word answers");
    expect(cloud.grant.cannot).toEqual(expect.arrayContaining(["Send email.", "Use AI.", "Contact any service outside this hub."]));
  });

  it("is an admin's: a resident cannot list, install or remove", async () => {
    expect((await call("GET", "/admin/hub/plugins/installs", HOST, undefined, resident)).status).toBe(403);
    expect((await call("POST", "/admin/hub/plugins/wordcloud/remove", HOST, { mode: "stop" }, resident)).status).toBe(403);
    expect((await call("POST", "/admin/hub/plugins/nothing/install", HOST, {}, admin)).status).toBe(404);
    expect((await call("POST", "/admin/hub/plugins/wordcloud/remove", HOST, { mode: "later" }, admin)).status).toBe(400);
  });

  it("Stop now is the switch-off: the type's routes answer 404, nothing is deleted, and Install brings it back", async () => {
    const made = await createCloud();
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    expect((await call("GET", `/wordcloud/${id}`, HOST)).status).toBe(200);

    const stop = await call("POST", "/admin/hub/plugins/wordcloud/remove", HOST, { mode: "stop" }, admin);
    expect(stop.status, JSON.stringify(stop.body)).toBe(200);
    expect(stop.body.plugin.state).toBe("removed");
    expect((await call("GET", `/wordcloud/${id}`, HOST)).status).toBe(404);
    expect((await createCloud()).status).toBe(404);
    expect((await record(WORDCLOUD)).removed_at).not.toBeNull();
    const civic = await call("GET", "/.well-known/civic.json", HOST);
    expect(civic.body.plugins.map((p: { package: string }) => p.package)).not.toContain(WORDCLOUD);

    const back = await call("POST", "/admin/hub/plugins/wordcloud/install", HOST, {}, admin);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.plugin.state).toBe("installed");
    expect((await call("GET", `/wordcloud/${id}`, HOST)).status).toBe(200);
    expect((await record(WORDCLOUD)).removed_at).toBeNull();

    const log = await call("GET", "/admin/hub/admin-log", HOST, undefined, admin);
    const actions = (log.body.entries ?? log.body.items ?? log.body).map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["plugin.remove", "plugin.install"]));
  });

  it("Wind down: nothing new can start, the open vote runs to its close, and the close job switches it off", async () => {
    const vote = await createVote(`Open vote ${run}`);
    expect(vote.status, JSON.stringify(vote.body)).toBe(201);
    const id = vote.body.id as string;
    await call("POST", `/process/${id}/action`, HOST, { type: "process.activate", payload: {} }, admin);
    expect((await one("vote")).open).toBeGreaterThanOrEqual(1);

    const wind = await call("POST", "/admin/hub/plugins/vote/remove", HOST, { mode: "wind_down" }, admin);
    expect(wind.status, JSON.stringify(wind.body)).toBe(200);
    expect(wind.body.plugin.state).toBe("winding_down");
    expect((await record("@civic-social/plugin-vote")).winding_down_since).not.toBeNull();

    const refused = await createVote(`Another vote ${run}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("plugin_winding_down");
    // What is open is still served and still takes part.
    expect((await call("GET", `/process/${id}/state`, HOST, undefined, resident)).status).toBe(200);

    // Still open: the job leaves it on.
    await call("GET", `/internal/vote-close/run?hub=${SLUG}`, HOST, undefined, CRON);
    expect((await one("vote")).state).toBe("winding_down");

    const close = await call("POST", `/process/${id}/action`, HOST, { type: "process.close", payload: { note: "Closed early by the plugin packages test." } }, admin);
    expect(close.status, JSON.stringify(close.body)).toBe(200);
    const job = await call("GET", `/internal/vote-close/run?hub=${SLUG}`, HOST, undefined, CRON);
    expect(job.status, JSON.stringify(job.body)).toBe(200);
    const after = await one("vote");
    expect(after.state).toBe("removed");
    expect((await record("@civic-social/plugin-vote")).removed_by).toBe("system:wind-down");

    expect((await call("POST", "/admin/hub/plugins/vote/install", HOST, {}, admin)).body.plugin.state).toBe("installed");
  });

  it("Wind down with nothing open stops at once, and is not offered for items that never close", async () => {
    const wind = await call("POST", "/admin/hub/plugins/conversation/remove", HOST, { mode: "wind_down" }, admin);
    expect(wind.status, JSON.stringify(wind.body)).toBe(200);
    expect(wind.body.plugin.state).toBe("removed");
    await call("POST", "/admin/hub/plugins/conversation/install", HOST, {}, admin);

    expect((await one("announcement")).wind_down_offered).toBe(false);
    const refused = await call("POST", "/admin/hub/plugins/announcement/remove", HOST, { mode: "wind_down" }, admin);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("wind_down_not_offered");
  });

  it("civic.json lists the installed packages with their versions", async () => {
    const civic = await call("GET", "/.well-known/civic.json", HOST);
    expect(civic.status).toBe(200);
    const listed = civic.body.plugins as Array<{ package: string; version: string; type: string; signed: boolean }>;
    expect(listed.length).toBeGreaterThanOrEqual(9);
    expect(listed).toContainEqual(expect.objectContaining({ package: WORDCLOUD, version: "0.1.0", type: "civic.wordcloud" }));
    // Signed approvals (ADR-015): with a catalog key, every package listed runs on a verified signature.
    const health = await call("GET", "/health", HOST);
    if (health.body.plugins.signatures.key) {
      expect(listed.every((p) => p.signed === true), JSON.stringify(listed)).toBe(true);
      expect(health.body.plugins.signatures.unsigned).toBe(0);
    }
  });
});

describe("the console's catalog", () => {
  it("lists every entry with its grant in plain words, and what the deployment mounts", async () => {
    const res = await consoleCall("GET", "/control/plugins", { cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cloud = res.body.entries.find((e: { package: string; status: string; matches_deployment: boolean }) => e.package === WORDCLOUD && e.matches_deployment);
    expect(cloud.status).toBe("approved");
    expect(cloud.grant.can.length).toBeGreaterThan(0);
    expect(res.body.deployment.every((v: { mounted: boolean }) => v.mounted)).toBe(true);
  });

  // One fixed pending row, written once per stack (catalog rows are never
  // deleted): a package the deployment does not load, waiting for approval.
  it("a hub never sees an entry the catalog has not approved", async () => {
    const hash = `sha256:${"0".repeat(64)}`;
    await db.query(
      `INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status)
       VALUES ('@test/plugin-unapproved', '0.1.0', $1, 'Unapproved', 'unapproved', 'civic.unapproved',
               '{"activities":{"emit":[],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":[]}}'::jsonb, '{"result":"passed","ran_at":"2026-10-25T00:00:00Z"}'::jsonb, 'pending')
       ON CONFLICT (package, version, hash) DO NOTHING`,
      [hash],
    );
    const list = await installs();
    expect(list.map((p) => p.plugin)).not.toContain("unapproved");
    const civic = await call("GET", "/.well-known/civic.json", HOST);
    expect(JSON.stringify(civic.body)).not.toContain("unapproved");
  });

  it("withdrawing an entry stops mounting it at once; approving it again brings it back; both take a fresh code and are audited", async () => {
    const list = await consoleCall("GET", "/control/plugins", { cookie });
    const entry = list.body.entries.find((e: { package: string; status: string; matches_deployment: boolean }) => e.package === WORDCLOUD && e.status === "approved" && e.matches_deployment);
    const noCode = await consoleCall("POST", `/control/plugins/${entry.id}/withdraw`, { cookie, body: {} });
    expect(noCode.status).toBe(403);
    expect(noCode.body.error).toBe("step_up_required");

    try {
      const out = await consoleCall("POST", `/control/plugins/${entry.id}/withdraw`, { cookie, body: { step_up_code: await stepCode() } });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      const cloud = out.body.deployment.find((v: { package: string }) => v.package === WORDCLOUD);
      expect(cloud.mounted).toBe(false);
      // The hub has it installed, so its admin is told why it is gone.
      expect((await one("wordcloud")).state).toBe("unavailable");
      expect((await createCloud()).status).toBe(404);
      const health = await call("GET", "/health", HOST);
      expect(health.status).toBe(200);
      expect(health.body.status).toBe("ok");
      expect(health.body.plugins.unmounted.map((u: { package: string }) => u.package)).toContain(WORDCLOUD);
    } finally {
      const again = await consoleCall("POST", `/control/plugins/${entry.id}/approve`, { cookie, body: { step_up_code: await stepCode() } });
      expect(again.status, JSON.stringify(again.body)).toBe(200);
    }
    expect((await one("wordcloud")).state).toBe("installed");
    const audit = await consoleCall("GET", "/control/audit", { cookie });
    const actions = (audit.body.entries ?? audit.body.rows ?? audit.body).map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["plugin.withdraw", "plugin.approve"]));
  });
});
// Signed approvals (plugin session 2, ADR-015). Needs a server with a catalog
// key and CIVIC_CATALOG_SIGNATURES=required, as CI runs it; skipped otherwise.
describe("signed approvals", () => {
  async function signing() {
    return (await call("GET", "/health", HOST)).body.plugins.signatures as { mode: string; key: string | null; unsigned: number };
  }
  async function wordcloudRow() {
    return (
      await db.query<{ id: string; signature: string | null; signature_key: string | null; signed_at: string | null }>(
        "SELECT id, signature, signature_key, signed_at FROM plugin_catalog WHERE package = $1 AND status = 'approved' ORDER BY approved_at DESC LIMIT 1",
        [WORDCLOUD],
      )
    ).rows[0];
  }
  async function wordcloudVerdict() {
    const view = await consoleCall("GET", "/control/plugins", { cookie });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    return { view: view.body, verdict: view.body.deployment.find((v: { package: string }) => v.package === WORDCLOUD) };
  }

  it("a row whose signature is missing or does not verify is unapproved; Sign approved entries signs it again, with a fresh code, audited", async (ctx) => {
    const sig = await signing();
    if (sig.mode !== "required" || !sig.key) ctx.skip();
    const row = await wordcloudRow();
    expect(row.signature_key).toBe(sig.key);
    try {
      // A signature that is not the console's: the right key id, the wrong bytes.
      const forged = Buffer.from(row.signature!, "base64");
      forged[0] ^= 0xff;
      await db.query("UPDATE plugin_catalog SET signature = $2 WHERE id = $1", [row.id, forged.toString("base64")]);
      let { verdict, view } = await wordcloudVerdict();
      expect(verdict.mounted).toBe(false);
      expect(verdict.reason).toContain("does not verify");
      expect(view.signing.unsigned).toBeGreaterThanOrEqual(1);
      expect((await one("wordcloud")).state).toBe("unavailable");

      // No signature at all, as a row a migration approved would have.
      await db.query("UPDATE plugin_catalog SET signature = NULL, signature_key = NULL, signed_at = NULL WHERE id = $1", [row.id]);
      ({ verdict } = await wordcloudVerdict());
      expect(verdict.mounted).toBe(false);
      expect(verdict.reason).toContain("not signed");

      const noCode = await consoleCall("POST", "/control/plugins/sign", { cookie, body: {} });
      expect(noCode.status).toBe(403);
      const signed = await consoleCall("POST", "/control/plugins/sign", { cookie, body: { step_up_code: await stepCode() } });
      expect(signed.status, JSON.stringify(signed.body)).toBe(200);
      expect(signed.body.signing.unsigned).toBe(0);
      expect(signed.body.deployment.find((v: { package: string }) => v.package === WORDCLOUD)).toMatchObject({ mounted: true, signed: true });
      expect((await wordcloudRow()).signature_key).toBe(sig.key);
      expect((await one("wordcloud")).state).toBe("installed");
      const audit = await consoleCall("GET", "/control/audit", { cookie });
      const entries = (audit.body.entries ?? audit.body.rows ?? audit.body) as Array<{ action: string; after: { entries?: Array<{ package: string }> } }>;
      const signRow = entries.find((r) => r.action === "plugin.sign");
      expect(signRow?.after.entries?.map((e) => e.package)).toContain(WORDCLOUD);
    } finally {
      // Whatever happened above, leave the row as it was, signed by the console.
      await db.query("UPDATE plugin_catalog SET signature = $2, signature_key = $3, signed_at = $4 WHERE id = $1", [
        row.id,
        row.signature,
        row.signature_key,
        row.signed_at,
      ]);
      await consoleCall("GET", "/control/plugins", { cookie });
    }
  });
});


// Versions and updates (plugin session 2, ADR-015). A deployment runs one
// version of each package for every hub; a hub records the version whose
// grant its admin approved and is held to that grant until it updates. Briefs
// 0.2.0 added the AI (the conversation summary moved to the brief): a hub
// still on 0.1.0's grant gets its conversation briefs without a written
// summary, and its Plugins page says why and offers the update.
describe("versions and updates", () => {
  const BRIEF = "@civic-social/plugin-brief";
  const AI_LINE = "Use the hub's AI service. Each use counts against the hub's daily AI allowance.";

  /** The hub as one that has not approved Briefs 0.2.0: 0.1.0, with 0.1.0's grant (no AI). */
  async function briefsBehind(): Promise<void> {
    await db.query(
      `UPDATE hub_plugins SET version = '0.1.0', capabilities = jsonb_set(capabilities, '{adapters}', '["mail"]'::jsonb),
              upgraded_from = NULL, upgraded_at = NULL, upgraded_by = NULL
        WHERE hub_id = $1 AND package = $2`,
      [SLUG, BRIEF],
    );
  }

  async function closedConversationBrief(topic: string): Promise<{ id: string; content: Record<string, any> }> {
    const made = await call("POST", "/deliberations", HOST, { title: topic, topic, framing: "What should the hub know?" }, admin);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body.id ?? made.body.process_id ?? made.body.process?.id) as string;
    const closed = await call("POST", `/process/${id}/action`, HOST, { type: "close", payload: { note: "Closed by the versions test." } }, admin);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const brief = (await db.query("SELECT state FROM processes WHERE hub_id = $1 AND type = 'civic.brief' AND state->>'source_process_id' = $2", [SLUG, id])).rows[0];
    expect(brief, "the close made a brief").toBeTruthy();
    return { id, content: brief.state.content };
  }

  it("a hub that has not approved the brief's AI still gets a brief, without a written summary, and its Plugins page says why", async () => {
    await briefsBehind();
    const { id, content } = await closedConversationBrief(`Not allowed ${run}`);
    expect(content.summary).toBe("");
    expect(content.deliberation.narrative).toBe("not_allowed");
    expect(content.deliberation.participation_stats).toBeTruthy();
    const page = await call("GET", `/deliberations/${id}`, HOST, undefined, admin);
    expect(page.body.summary.narrative).toBe("not_allowed");

    const briefs = await one("brief");
    expect(briefs.update_available).toBe(true);
    const pkg = (briefs.packages as Array<any>).find((p) => p.package === BRIEF);
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.update).toEqual({ version: "0.2.0", adds: [AI_LINE], drops: [] });
    expect(pkg.grant.cannot).toContain("Use AI.");
  });

  it("Update records the new version and grant, is in the admin log, and the next brief is written", async () => {
    await briefsBehind();
    expect((await call("POST", "/admin/hub/plugins/brief/update", HOST, {}, resident)).status).toBe(403);
    const updated = await call("POST", "/admin/hub/plugins/brief/update", HOST, {}, admin);
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.plugin.update_available).toBe(false);
    const row = (await db.query("SELECT version, capabilities, upgraded_from, upgraded_by FROM hub_plugins WHERE hub_id = $1 AND package = $2", [SLUG, BRIEF])).rows[0];
    expect(row).toMatchObject({ version: "0.2.0", upgraded_from: "0.1.0" });
    expect(row.capabilities.adapters).toContain("ai");
    expect(row.upgraded_by).not.toBe("system:required");
    const log = (await db.query("SELECT after FROM hub_admin_audit_log WHERE hub_id = $1 AND action = 'plugin.update' ORDER BY at DESC LIMIT 1", [SLUG])).rows[0];
    expect(log.after).toMatchObject({ version: "0.2.0", adds: [AI_LINE] });

    const { content } = await closedConversationBrief(`Allowed ${run}`);
    expect(content.deliberation.narrative).toBeUndefined();
    expect(content.summary).toMatch(/^What participants said about Allowed /);
  });

  it("an open vote keeps working across an update: made before, it reads and closes after", async () => {
    // As a hub on an older Votes record (the same code serves every version: option B).
    await db.query("UPDATE hub_plugins SET version = '0.0.9' WHERE hub_id = $1 AND package = '@civic-social/plugin-vote'", [SLUG]);
    const made = await createVote(`Across an update ${run}`);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    expect((await call("POST", `/process/${id}/action`, HOST, { type: "process.activate", payload: {} }, admin)).status).toBe(200);
    expect((await one("vote")).update_available).toBe(true);
    expect((await call("POST", "/admin/hub/plugins/vote/update", HOST, {}, admin)).status).toBe(200);
    expect((await record("@civic-social/plugin-vote")).version).toBe("0.1.0");
    const read = await call("GET", `/process/${id}/state`, HOST, undefined, admin);
    expect(read.status).toBe(200);
    expect(read.body.status ?? read.body.lifecycle).toBe("active");
    const closed = await call("POST", `/process/${id}/action`, HOST, { type: "process.close", payload: { note: "Closed after the update." } }, admin);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    // A closed vote is finalized at once (its brief waits for an admin).
    expect(["closed", "finalized"]).toContain((await call("GET", `/process/${id}/state`, HOST, undefined, admin)).body.status);
  });

  it("a version marked required moves every hub on an older one, with a notice on its Plugins page", async () => {
    await briefsBehind();
    const view = await consoleCall("GET", "/control/plugins", { cookie });
    const entry = view.body.entries.find((e: any) => e.package === BRIEF && e.version === "0.2.0" && e.status === "approved" && e.matches_deployment);
    expect(entry, "Briefs 0.2.0 is approved and running").toBeTruthy();
    const wasRequired = entry.required as boolean;
    try {
      if (wasRequired) {
        expect((await consoleCall("POST", `/control/plugins/${entry.id}/required`, { cookie, body: { required: false, step_up_code: await stepCode() } })).status).toBe(200);
      }
      expect((await consoleCall("POST", `/control/plugins/${entry.id}/required`, { cookie, body: { required: true } })).status).toBe(403);
      const marked = await consoleCall("POST", `/control/plugins/${entry.id}/required`, { cookie, body: { required: true, step_up_code: await stepCode() } });
      expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      const row = (await db.query("SELECT version, upgraded_from, upgraded_by FROM hub_plugins WHERE hub_id = $1 AND package = $2", [SLUG, BRIEF])).rows[0];
      expect(row).toEqual({ version: "0.2.0", upgraded_from: "0.1.0", upgraded_by: "system:required" });
      const briefs = await one("brief");
      expect(briefs.update_available).toBe(false);
      const pkg = (briefs.packages as Array<any>).find((p) => p.package === BRIEF);
      expect(pkg.required_update).toMatchObject({ from: "0.1.0", to: "0.2.0" });
    } finally {
      if (!wasRequired) {
        await consoleCall("POST", `/control/plugins/${entry.id}/required`, { cookie, body: { required: false, step_up_code: await stepCode() } });
      }
    }
  });
});
