// Phase 5 part two, step 4: "Export this hub" in the super admin, and the
// hourly sweep that deletes export objects after 24 hours.
//
// The console route takes a fresh code, writes the archive to the private
// hub-exports bucket, records `hub.export` in the audit log, and answers with
// a signed link that downloads a real bundle. The sweep (a platform job) is
// called like Vercel Cron calls it; an object is aged by moving its
// storage.objects.created_at back, which only the local stack's Postgres
// allows. LOCAL ONLY. Needs CIVIC_CONSOLE_HOSTNAME=console.localhost and
// CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test on the server (CI sets
// both) and the server's CRON_SECRET in CIVIC_TEST_CRON_SECRET (CI's value is
// the default).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { localStack } from "../fixtures/adminSession.js";
import { auditFor, consoleCall, mintConsoleSession, plantCode } from "../fixtures/consoleCall.js";
import { api } from "../fixtures/helpers.js";
import { unpackTarGz } from "../../src/control/hubBundle/tar.js";

const HUB = "athens";
const BUCKET = "hub-exports";
const CRON_SECRET = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { url: SUPA_URL, key: SUPA_KEY } = localStack();
const run = Date.now().toString(36);
const OLD = `sweep-${run}/old.tar.gz`;
const NEW = `sweep-${run}/new.tar.gz`;
const auth = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

let cookie = "";
let exportedKey: string | null = null;

async function stepCode(): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await plantCode("step_up", code);
  return code;
}

async function objectsUnder(prefix: string): Promise<string[]> {
  const res = await fetch(`${SUPA_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  const rows = (await res.json()) as Array<{ name: string; id: string | null }>;
  return rows.filter((r) => r.id !== null).map((r) => `${prefix}/${r.name}`);
}

async function put(key: string): Promise<void> {
  const res = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/gzip" },
    body: Buffer.from("not really an archive"),
  });
  expect(res.ok, await res.text()).toBe(true);
}

async function remove(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: keys }),
  });
}

beforeAll(async () => {
  cookie = await mintConsoleSession();
});

afterAll(async () => {
  await remove([OLD, NEW, ...(exportedKey ? [exportedKey] : [])]);
});

describe("Export this hub (console)", () => {
  it("needs a fresh code, and stores nothing without one", async () => {
    const before = await objectsUnder(HUB);
    const res = await consoleCall("POST", `/control/hubs/${HUB}/export`, { cookie, body: {} });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("step_up_required");
    expect(await objectsUnder(HUB)).toEqual(before);
  });

  it("is not reachable on a hub's hostname", async () => {
    const res = await consoleCall("POST", `/control/hubs/${HUB}/export`, { cookie, host: "athens.localhost", body: {} });
    expect(res.status).toBe(404);
  });

  it("writes the archive to the private bucket, audits it, and hands back a working link", async () => {
    const res = await consoleCall("POST", `/control/hubs/${HUB}/export`, { cookie, body: { step_up_code: await stepCode() } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = res.body;
    exportedKey = out.object_key;
    expect(out.object_key).toMatch(new RegExp(`^${HUB}/civic-hub-export-${HUB}-\\d{8}T\\d{6}Z\\.tar\\.gz$`));
    expect(out.format_version).toBe(1);
    expect(Date.parse(out.expires_at) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);

    // The bucket is private: the public URL does not serve it.
    const publicUrl = `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${out.object_key}`;
    expect((await fetch(publicUrl)).status).toBeGreaterThanOrEqual(400);

    const dl = await fetch(out.url);
    expect(dl.status).toBe(200);
    const bytes = Buffer.from(await dl.arrayBuffer());
    expect(bytes.length).toBe(out.size);
    const files = unpackTarGz(bytes);
    const root = out.file_name.replace(/\.tar\.gz$/, "");
    const manifest = JSON.parse(files.find((f) => f.path === `${root}/manifest.json`)!.data.toString("utf8"));
    expect(manifest.hub_id).toBe(HUB);
    expect(manifest.fingerprint).toBe(out.fingerprint);
    expect(manifest.exported_by).toBe("console:operator@example.test");
    expect(files.some((f) => f.path === `${root}/README.md`)).toBe(true);
    expect(gunzipSync(bytes).length).toBeGreaterThan(bytes.length / 2);

    const audit = (await auditFor(HUB)).filter((a) => a.action === "hub.export").pop()!;
    expect(audit.actor_email).toBe("operator@example.test");
    expect(audit.after).toMatchObject({ object_key: out.object_key, size: out.size, fingerprint: out.fingerprint });
  }, 60_000);
});

describe("hub_exports_sweep (platform job)", () => {
  it("deletes export objects older than 24 hours and keeps newer ones", async () => {
    await put(OLD);
    await put(NEW);
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("update storage.objects set created_at = now() - interval '25 hours' where bucket_id = $1 and name = $2", [BUCKET, OLD]);
    } finally {
      await db.end();
    }

    expect((await api("/internal/hub-exports-sweep/run", { method: "GET" })).status).toBe(401);
    const res = await api("/internal/hub-exports-sweep/run", { method: "GET", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job).toBe("hub_exports_sweep");
    expect(body.platform.keys).toContain(OLD);
    expect(body.platform.keys).not.toContain(NEW);
    expect(await objectsUnder(`sweep-${run}`)).toEqual([NEW]);
  }, 30_000);
});
