// Phase 5 part two: a hub's export, import and restore, end to end, on the
// local stack — the repeatable form of "export Athens from dev and load it
// into a fresh install". A throwaway hub is seeded with rows in the tables
// that matter (users, a vote under review with its turns, events, comments,
// a link, ballots, a waitlist entry, a session and a live sign-in code that
// must NOT leave, and a secret-shaped setting that must not either) and two
// stored images, one under its prefix and one in the legacy `hubs/<id>/`
// folder. Then, through the real scripts and their env-file rule:
//
//   1. export-hub.ts  → a bundle whose README, counts and omissions are right
//   2. import-hub.ts  → refused while the hub exists, nothing changed
//   3. the hub is wiped from the stack, import-hub.ts loads it back: counts
//      and fingerprint verified by the importer, image URLs rewritten onto
//      the hub's prefix and resolving, the hub serving at its hostname
//   4. a "mistake" (a comment deleted, a title changed), restore-hub.ts
//      refused without --clear-append-only, then run with it: the rows are
//      back, the fingerprint equal, a hub.restore audit row written
//   5. import-hub.ts --no-images into a plain Postgres database created in
//      the same cluster from supabase/migrations (no PostgREST, no Storage)
//
// LOCAL ONLY: the Postgres URL defaults to the stack's fixed local one and
// anything that is not this machine is refused. Runs in both CI passes (the
// server's mode only matters for step 3's hub-config read).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { request } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { localStack } from "../fixtures/adminSession.js";
import { API_BASE } from "../fixtures/helpers.js";

const run = promisify(execFile);
const ROOT = join(__dirname, "../..");
const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`hubExportRoundTrip: refusing ${host}; local stack only.`);
}
const { url: SUPA_URL, key: SUPA_KEY } = localStack();
const BUCKET = "post-images";
const pub = (key: string) => `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${key}`;

const HUB = `rt-${randomBytes(4).toString("hex")}`;
const HOST = `${HUB}.localhost`;
const PLAIN_DB = `civic_rt_${randomBytes(4).toString("hex")}`;
// A fictional reference row (state "zz"): the hub's jurisdiction_ocd_id must
// travel in hub.json and find its row on the target.
const OCD = `ocd-division/country:us/state:zz/place:rt_${randomBytes(4).toString("hex")}`;
const JURISDICTION_ROW = [OCD, "9900001", "zz", "town", "Roundtrip town", "Town of Roundtrip, Nowhere"];
const insertJurisdiction = (c: pg.Client) =>
  c.query("insert into jurisdictions (ocd_id, census_geoid, state, type, official_name, display_name) values ($1, $2, $3, $4, $5, $6)", JURISDICTION_ROW);
const ids = {
  u1: `user_${randomBytes(6).toString("hex")}`,
  u2: `user_${randomBytes(6).toString("hex")}`,
  vote: `proc_${randomBytes(6).toString("hex")}`,
  prop: `proc_${randomBytes(6).toString("hex")}`,
  review: `rev_${randomBytes(6).toString("hex")}`,
  comment: `ci_${randomBytes(6).toString("hex")}`,
};
const IMG_NEW = `${HUB}/2026/09/${randomUUID()}.png`;
const IMG_LEGACY = `hubs/${HUB}/2026/01/${randomUUID()}.png`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

let db: pg.Client;
let work: string;
let envFile: string;
let bundle: string;

async function storage(method: string, key: string, body?: Buffer): Promise<Response> {
  return fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, ...(body ? { "Content-Type": "image/png" } : {}) },
    body,
  });
}

async function script(name: string, args: string[], env = envFile): Promise<{ code: number; out: string }> {
  try {
    const r = await run("node", [`--env-file=${env}`, "--import", "tsx", `scripts/${name}`, ...args], {
      cwd: ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** GET /hub-config as `host` — node:http, because fetch silently drops a Host override. */
function hubConfig(host: string): Promise<{ status: number; body: any }> {
  const url = new URL(`${API_BASE}/hub-config`);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "GET", headers: { Accept: "application/json", Host: host } },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            reject(new Error(`hub-config ${res.statusCode}: ${raw.slice(0, 120)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function counts(client: pg.Client, hub: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ["users", "processes", "process_reviews", "review_turns", "events", "community_inputs", "process_links", "vote_participation", "vote_records", "waitlist", "hub_settings", "sessions", "pending_verifications"]) {
    const r = await client.query(`select count(*)::int as n from ${t} where hub_id = $1`, [hub]);
    out[t] = r.rows[0].n;
  }
  return out;
}

/** Everything of the hub gone from the stack, as if it had never been here. */
async function wipeHub(): Promise<void> {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  for (const t of ["review_turns", "events", "process_links", "community_inputs", "vote_records", "vote_participation", "sessions", "pending_verifications", "process_reviews", "processes", "waitlist", "hub_settings", "users"]) {
    await db.query(`delete from ${t} where hub_id = $1`, [HUB]);
  }
  await db.query("delete from hubs where id = $1", [HUB]);
  await db.query("commit");
  await storage("DELETE", IMG_NEW);
  await storage("DELETE", IMG_LEGACY);
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  work = await mkdtemp(join(tmpdir(), "civic-rt-"));
  envFile = join(work, "target.env");
  await writeFile(
    envFile,
    [
      `SUPABASE_URL=${SUPA_URL}`,
      `SUPABASE_SERVICE_ROLE_KEY=${SUPA_KEY}`,
      `CIVIC_TARGET_DATABASE_URL=${DB_URL}`,
      `CIVIC_TARGET_SUPABASE_URL=${SUPA_URL}`,
      `CIVIC_TARGET_SERVICE_ROLE_KEY=${SUPA_KEY}`,
    ].join("\n") + "\n",
  );

  expect((await storage("POST", IMG_NEW, PNG)).ok).toBe(true);
  expect((await storage("POST", IMG_LEGACY, PNG)).ok).toBe(true);

  const q = (sql: string, params: unknown[]) => db.query(sql, params);
  await insertJurisdiction(db);
  await q(
    `insert into hubs (id, protocol_hub_id, hostname, name, space_did, mode, jurisdiction_ocd_id) values ($1, $2, $3, $4, $5, 'demo', $6)`,
    [HUB, `civic-hub-${HUB}`, HOST, "Round Trip Hub", `did:web:${HOST}`, OCD],
  );
  await q(`insert into hub_settings (hub_id, key, value) values ($1, 'identity.name', 'Round Trip Hub'), ($1, 'identity.banner_url', $2), ($1, 'demo_bypass_code', '424242')`, [HUB, pub(IMG_LEGACY)]);
  await q(`insert into users (id, hub_id, email, full_name, email_verified) values ($1, $3, $4, 'Ada Resident', true), ($2, $3, $5, 'Bo Resident', true)`, [ids.u1, ids.u2, HUB, `ada+${HUB}@example.test`, `bo+${HUB}@example.test`]);
  await q(
    `insert into processes (id, hub_id, type, title, status, state, created_by) values
       ($1, $3, 'civic.vote', 'New park benches?', 'active', $4::jsonb, $5),
       ($2, $3, 'civic.proposal', 'Benches on Main', 'closed', '{}'::jsonb, $5)`,
    [ids.vote, ids.prop, HUB, JSON.stringify({ banner_image_url: pub(IMG_NEW), body: `Photo: ${pub(IMG_NEW)}`, options: ["Yes", "No"] }), ids.u1],
  );
  await q(`insert into process_reviews (id, hub_id, process_id, creator_id, creator_name, creator_email, status) values ($1, $2, $3, $4, 'Ada Resident', $5, 'approved')`, [ids.review, HUB, ids.vote, ids.u1, `ada+${HUB}@example.test`]);
  await q(`update processes set review_id = $1 where id = $2`, [ids.review, ids.vote]);
  await q(`insert into review_turns (id, hub_id, review_id, turn_number, actor, actor_role, action, note) values ($1, $3, $2, 1, $4, 'creator', 'submit', 'first'), ($5, $3, $2, 2, 'admin', 'admin', 'approve', 'ok')`, [`rt_${randomBytes(6).toString("hex")}`, ids.review, HUB, ids.u1, `rt_${randomBytes(6).toString("hex")}`]);
  await q(`insert into events (id, hub_id, event_type, process_id, actor, data, created_at) values ($1, $3, 'civic.process.created', $4, $5, '{}'::jsonb, '2026-09-01T10:00:00.123456Z'), ($2, $3, 'civic.process.started', $4, $5, '{"x":1}'::jsonb, '2026-09-01T10:00:01Z')`, [randomUUID(), randomUUID(), HUB, ids.vote, ids.u1]);
  await q(`insert into community_inputs (id, hub_id, process_id, author_id, body) values ($1, $2, $3, $4, 'Yes please, near the library.')`, [ids.comment, HUB, ids.vote, ids.u2]);
  await q(`insert into process_links (id, hub_id, from_id, to_id, relation, created_by) values ($1, $2, $3, $4, 'continues', $5)`, [`link_${randomBytes(6).toString("hex")}`, HUB, ids.vote, ids.prop, ids.u1]);
  await q(`insert into vote_participation (user_id, process_id, hub_id, has_voted) values ($1, $2, $3, true)`, [ids.u2, ids.vote, HUB]);
  await q(`insert into vote_records (receipt_id, process_id, hub_id, choice) values ($1, $2, $3, 'Yes')`, [`rcpt_${randomBytes(6).toString("hex")}`, ids.vote, HUB]);
  await q(`insert into waitlist (email, hub_id, name) values ($1, $2, 'Cy')`, [`cy+${HUB}@example.test`, HUB]);
  await q(`insert into sessions (token, user_id, hub_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [randomBytes(16).toString("hex"), ids.u1, HUB]);
  await q(`insert into pending_verifications (email, hub_id, code, expires_at) values ($1, $2, '111111', now() + interval '10 minutes')`, [`dee+${HUB}@example.test`, HUB]);
}, 60_000);

afterAll(async () => {
  // Archived, as control.test.ts leaves its hubs: the audit log references
  // this one so it cannot be deleted, and the per-hub job runs in
  // crons.test.ts (CI's second pass, same database) must see only Floyd and
  // Athens.
  await db?.query("update hubs set status = 'suspended', archived_at = now(), jurisdiction_ocd_id = null where id = $1", [HUB]).catch(() => undefined);
  await db?.query("delete from jurisdictions where ocd_id = $1", [OCD]).catch(() => undefined);
  await db?.query(`drop database if exists ${PLAIN_DB}`).catch(() => undefined);
  await db?.end();
});

describe("hub export → import → restore, on the local stack", () => {
  let before: Record<string, number>;

  it("exports a documented bundle without secrets", async () => {
    before = await counts(db, HUB);
    const r = await script("export-hub.ts", ["--hub", HUB, "--out", work]);
    expect(r.code, r.out).toBe(0);
    const name = (await readdir(work)).find((f) => f.startsWith(`civic-hub-export-${HUB}-`))!;
    bundle = join(work, name);

    const m = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
    expect(m.format_version).toBe(1);
    const rows = Object.fromEntries(m.tables.map((t: { table: string; rows: number }) => [t.table, t.rows]));
    for (const t of ["users", "processes", "process_reviews", "review_turns", "events", "community_inputs", "process_links", "vote_participation", "vote_records", "waitlist"]) {
      expect(rows[t], t).toBe(before[t]);
    }
    expect(rows.hub_settings).toBe(before.hub_settings - 1);
    expect(m.excluded_settings.map((s: { key: string }) => s.key)).toEqual(["demo_bypass_code"]);
    expect(m.tables.map((t: { table: string }) => t.table)).not.toContain("sessions");
    expect(m.omitted_tables.map((t: { table: string }) => t.table).sort()).toEqual(["link_previews", "pending_verifications", "sessions"]);
    expect(m.images.count).toBe(2);
    expect(JSON.parse(await readFile(join(bundle, "hub.json"), "utf8")).jurisdiction_ocd_id).toBe(OCD);

    const images = JSON.parse(await readFile(join(bundle, "images.json"), "utf8"));
    const legacy = images.find((i: { source_key: string }) => i.source_key === IMG_LEGACY);
    expect(legacy.rule).toBe("legacy-hubs-folder");
    expect(legacy.target_key).toBe(`${HUB}/identity/${IMG_LEGACY.split("/").slice(2).join("/")}`);

    const readme = await readFile(join(bundle, "README.md"), "utf8");
    expect(readme).toContain("demo_bypass_code");
    expect(readme).toContain("sessions");
    const all = (await readFile(join(bundle, "tables/hub_settings.jsonl"), "utf8")) + (await readFile(join(bundle, "tables/users.jsonl"), "utf8"));
    expect(all).not.toContain("424242");
  }, 60_000);

  it("refuses to import over a hub that exists, changing nothing", async () => {
    const r = await script("import-hub.ts", [bundle]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already exists/);
    expect(await counts(db, HUB)).toEqual(before);
  }, 60_000);

  it("refuses a database URL on the command line", async () => {
    const r = await script("import-hub.ts", [bundle, "--dry-run", DB_URL]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/env file/);
  }, 60_000);

  it("loads the hub into a stack without it: rows, images, URLs, hostname", async () => {
    await wipeHub();
    expect((await counts(db, HUB)).users).toBe(0);

    const r = await script("import-hub.ts", [bundle, "--actor", "ci@example.test"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/matches the bundle/);

    const now = await counts(db, HUB);
    expect(now).toEqual({ ...before, hub_settings: before.hub_settings - 1, sessions: 0, pending_verifications: 0 });

    // The review cycle survived the ordering.
    const p = await db.query("select review_id, state from processes where id = $1", [ids.vote]);
    expect(p.rows[0].review_id).toBe(ids.review);
    // URLs now point at this storage, under the hub's prefix, and resolve.
    expect(p.rows[0].state.banner_image_url).toBe(pub(IMG_NEW));
    const banner = await db.query("select value from hub_settings where hub_id = $1 and key = 'identity.banner_url'", [HUB]);
    const moved = `${HUB}/identity/${IMG_LEGACY.split("/").slice(2).join("/")}`;
    expect(banner.rows[0].value).toBe(pub(moved));
    for (const key of [IMG_NEW, moved]) expect((await fetch(pub(key))).status, key).toBe(200);
    // The search index was rebuilt on the way in.
    const s = await db.query("select search_doc is not null as ok from processes where id = $1", [ids.vote]);
    expect(s.rows[0].ok).toBe(true);

    expect((await db.query("select jurisdiction_ocd_id from hubs where id = $1", [HUB])).rows[0].jurisdiction_ocd_id).toBe(OCD);
    const audit = await db.query("select actor_email from control_audit_log where action = 'hub.import' and target_hub_id = $1", [HUB]);
    expect(audit.rows.map((x) => x.actor_email)).toEqual(["ci@example.test"]);

    const res = await hubConfig(HOST);
    expect(res.status).toBe(200);
    const cfg = res.body;
    expect(cfg.hub.id).toBe(HUB);
    expect(cfg.settings["identity.name"]).toBe("Round Trip Hub");
  }, 90_000);

  it("restores the hub after a mistake, only with --clear-append-only", async () => {
    await db.query("delete from community_inputs where id = $1", [ids.comment]);
    await db.query("update processes set title = 'oops' where id = $1", [ids.vote]);

    const refused = await script("restore-hub.ts", [bundle, "--hub", HUB]);
    expect(refused.code).not.toBe(0);
    expect(refused.out).toMatch(/--clear-append-only/);
    expect((await db.query("select title from processes where id = $1", [ids.vote])).rows[0].title).toBe("oops");

    const r = await script("restore-hub.ts", [bundle, "--hub", HUB, "--clear-append-only", "--actor", "ci@example.test"]);
    expect(r.code, r.out).toBe(0);
    expect((await db.query("select title from processes where id = $1", [ids.vote])).rows[0].title).toBe("New park benches?");
    expect((await db.query("select count(*)::int as n from community_inputs where id = $1", [ids.comment])).rows[0].n).toBe(1);
    const audit = await db.query("select before, after from control_audit_log where action = 'hub.restore' and target_hub_id = $1", [HUB]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before.rows.community_inputs).toBe(0);
    expect(audit.rows[0].after.cleared_append_only).toEqual(["events", "review_turns"]);
  }, 90_000);

  it("loads into a plain Postgres database (no PostgREST, no Storage)", async () => {
    await db.query(`create database ${PLAIN_DB}`);
    const plainUrl = DB_URL.replace(/\/[^/]*$/, `/${PLAIN_DB}`);
    const plain = new pg.Client({ connectionString: plainUrl });
    await plain.connect();
    try {
      const dir = join(ROOT, "supabase/migrations");
      for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort()) {
        await plain.query(await readFile(join(dir, f), "utf8"));
      }
      const env = join(work, "plain.env");
      await writeFile(env, `CIVIC_TARGET_DATABASE_URL=${plainUrl}\n`);

      const noFlag = await script("import-hub.ts", [bundle], env);
      expect(noFlag.code).not.toBe(0);
      expect(noFlag.out).toMatch(/no storage/);

      // The target's reference list lacks the hub's jurisdiction: refused, by name.
      const noRow = await script("import-hub.ts", [bundle, "--no-images", "--hostname", `${HUB}.example.test`], env);
      expect(noRow.code).not.toBe(0);
      expect(noRow.out).toContain(`serves jurisdiction ${OCD}`);
      await insertJurisdiction(plain);

      const r = await script("import-hub.ts", [bundle, "--no-images", "--hostname", `${HUB}.example.test`], env);
      expect(r.code, r.out).toBe(0);
      expect((await plain.query("select jurisdiction_ocd_id from hubs where id = $1", [HUB])).rows[0].jurisdiction_ocd_id).toBe(OCD);
      expect(await counts(plain, HUB)).toEqual({ ...before, hub_settings: before.hub_settings - 1, sessions: 0, pending_verifications: 0 });
    } finally {
      await plain.end();
    }
  }, 120_000);
});
