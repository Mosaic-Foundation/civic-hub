// scripts/purge-hub.ts (2026-09-27, Adam): freeing a never-used hub's slug.
//
//   1. A hub with one real resident is refused, and nothing changes.
//   2. A hub created through the console with sample content, then archived
//      (one hub admin audit row planted, as a fresh-code action would write):
//      without --confirm the script only prints its plan; with it, the bundle
//      is written first and holds the admin audit row, every row with its
//      hub_id is gone, its hubs row is gone, the hub.purge audit row holds the
//      full hubs row (created_at included), and the slug can be created again.
//
// Needs the console on console.localhost (CI's env) and the local stack.
// LOCAL ONLY, like hubExportRoundTrip.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { localStack } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { readBundleFiles } from "../../scripts/lib/hubImport.js";

const run = promisify(execFile);
const ROOT = join(__dirname, "../..");
const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`hubPurge: refusing ${host}; local stack only.`);
}
const { url: SUPA_URL, key: SUPA_KEY } = localStack();

const tag = randomBytes(3).toString("hex");
const REAL = `pg-real-${tag}`;
const SAMPLE = `pg-samp-${tag}`;
const ADMIN = `purge-admin-${tag}@example.test`;

let db: pg.Client;
let work: string;
let envFile: string;
let cookie = "";
const toArchive: string[] = [];

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function script(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const r = await run("node", [`--env-file=${envFile}`, "--import", "tsx", "scripts/purge-hub.ts", ...args], {
      cwd: ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

async function hubIdRows(hub: string): Promise<number> {
  const t = await db.query<{ table_name: string }>(
    "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'hub_id'",
  );
  let n = 0;
  for (const { table_name } of t.rows) {
    const r = await db.query(`select count(*)::int as n from "${table_name}" where hub_id = $1`, [hub]);
    n += r.rows[0].n;
  }
  return n;
}

async function createHub(slug: string, extra: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug, name: `Purge Test ${slug}`, hostname: `${slug}.localhost`, admin_email: ADMIN, hub_kind: "other", ...extra },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function archive(slug: string): Promise<void> {
  const res = await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie, body: { step_up_code: await stepCode() } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  cookie = await mintConsoleSession();
  work = await mkdtemp(join(tmpdir(), "civic-purge-"));
  envFile = join(work, "purge.env");
  await writeFile(
    envFile,
    [`SUPABASE_URL=${SUPA_URL}`, `SUPABASE_SERVICE_ROLE_KEY=${SUPA_KEY}`, `CIVIC_TARGET_DATABASE_URL=${DB_URL}`].join("\n") + "\n",
  );
}, 60_000);

afterAll(async () => {
  for (const id of toArchive) {
    const res = await consoleCall("POST", `/control/hubs/${id}/archive`, { cookie, body: { step_up_code: await stepCode() } });
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
  await db?.end();
});

describe("purge-hub.ts", () => {
  it("refuses a hub with one real resident, and changes nothing", async () => {
    await createHub(REAL);
    toArchive.push(REAL);
    await archive(REAL);
    await db.query("insert into users (id, hub_id, email, full_name, email_verified) values ($1, $2, $3, 'Rae Resident', true)", [
      `user_${randomBytes(6).toString("hex")}`,
      REAL,
      `rae+${tag}@example.test`,
    ]);
    const before = await hubIdRows(REAL);

    const r = await script(["--hub", REAL, "--confirm", REAL]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/not a never-used hub/);
    expect(r.out).toMatch(/1 user\(s\) besides its admins/);
    expect(r.out).toContain(`rae+${tag}@example.test`);

    const hub = await db.query("select id from hubs where id = $1", [REAL]);
    expect(hub.rowCount).toBe(1);
    expect(await hubIdRows(REAL)).toBe(before);
    const audit = await db.query("select 1 from control_audit_log where action = 'hub.purge' and target_hub_id = $1", [REAL]);
    expect(audit.rowCount).toBe(0);
  }, 60_000);

  it("refuses a hub that is not archived", async () => {
    await createHub(SAMPLE, { hub_kind: "place", sample_content: true, jurisdiction_type: "town", jurisdiction_name: "Example, Nowhere", jurisdiction_custom: true });
    toArchive.push(SAMPLE);
    const r = await script(["--hub", SAMPLE, "--confirm", SAMPLE]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/not archived/);
  }, 120_000);

  it("purges a freshly archived sample-only hub, export first, and frees its slug", async () => {
    await archive(SAMPLE);
    toArchive.splice(toArchive.indexOf(SAMPLE), 1);
    // A fresh-code action by the hub's admin, as the audit service writes it.
    await db.query(
      "insert into hub_admin_audit_log (hub_id, actor_email, action, before, after) values ($1, $2, 'hub.mode', '{\"mode\":\"demo\"}', '{\"mode\":\"beta\"}')",
      [SAMPLE, ADMIN],
    );
    const hubRow = (await db.query("select to_jsonb(h) as r from hubs h where id = $1", [SAMPLE])).rows[0].r;
    const samples = await db.query("select count(*)::int as n from processes where hub_id = $1 and is_sample", [SAMPLE]);
    expect(samples.rows[0].n).toBeGreaterThan(0);

    // Without --confirm: the plan, and nothing done.
    const dry = await script(["--hub", SAMPLE, "--out", work]);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toMatch(/Would delete/);
    expect(dry.out).toMatch(/hub_admin_audit_log: 1 row\(s\).*AFTER the export bundle has captured them/s);
    expect(dry.out).toMatch(/Nothing done/);
    expect((await db.query("select 1 from hubs where id = $1", [SAMPLE])).rowCount).toBe(1);

    // A mismatched --confirm is refused.
    const wrong = await script(["--hub", SAMPLE, "--confirm", "someone-else", "--out", work]);
    expect(wrong.code, wrong.out).toBe(2);
    expect((await db.query("select 1 from hubs where id = $1", [SAMPLE])).rowCount).toBe(1);

    const r = await script(["--hub", SAMPLE, "--confirm", SAMPLE, "--out", work, "--actor", "ci@example.test"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("is purged");

    // Everything gone.
    expect((await db.query("select 1 from hubs where id = $1", [SAMPLE])).rowCount).toBe(0);
    expect(await hubIdRows(SAMPLE)).toBe(0);

    // The bundle, written first, holds the admin audit row.
    const path = /exported → (\S+\.tar\.gz)/.exec(r.out)?.[1];
    expect(path, r.out).toBeTruthy();
    await access(path!);
    const { files } = await readBundleFiles(path!);
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
    expect(manifest.tables.find((t: { table: string }) => t.table === "hub_admin_audit_log").rows).toBe(1);
    expect(JSON.parse(files.get("hub.json")!.toString("utf8")).id).toBe(SAMPLE);

    // The audit row: the full hubs row before, the bundle after.
    const audit = await db.query(
      "select actor_email, before, after from control_audit_log where action = 'hub.purge' and target_hub_id = $1",
      [SAMPLE],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].actor_email).toBe("ci@example.test");
    expect(audit.rows[0].before).toEqual(hubRow);
    expect(audit.rows[0].before.created_at).toBeTruthy();
    expect(audit.rows[0].after.bundle).toBe(path);
    // The earlier rows (hub.create, hub.archive) survive the purge.
    const history = await db.query("select action from control_audit_log where target_hub_id = $1 order by id", [SAMPLE]);
    expect(history.rows.map((x) => x.action)).toEqual(expect.arrayContaining(["hub.create", "hub.archive", "hub.purge"]));

    // The slug and hostname are free: the console creates the hub again.
    await createHub(SAMPLE);
    toArchive.push(SAMPLE);
  }, 180_000);
});
