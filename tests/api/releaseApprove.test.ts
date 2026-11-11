// A release's approval of first-party catalog entries (ADR-015 amendment,
// console slice, 2026-11-10): POST /control/plugins/release-approve with
// CIVIC_RELEASE_SECRET as the bearer. The server approves and signs, as the
// console's Approve does, only a first-party entry that is pending with the
// fingerprint the release sent; anything else stays pending, with why.
//
// Needs a server with CIVIC_RELEASE_SECRET set and the same value here as
// CIVIC_TEST_RELEASE_SECRET (as CI runs both servers); skipped otherwise.
// Rows are written into the local catalog under a test package and withdrawn
// after (catalog rows are never deleted; hashes no deployment loads, so
// nothing mounts them).

import { afterAll, describe, expect, it } from "vitest";
import { consoleSql } from "../fixtures/consoleDb.js";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { localRest } from "../fixtures/adminSession.js";
import { CONSOLE_HOST } from "../fixtures/consoleCall.js";

const SECRET = process.env.CIVIC_TEST_RELEASE_SECRET?.trim();
const API_BASE = process.env.CIVIC_API_BASE?.trim() || "http://localhost:3000";
const FIRST = "@civic-social/plugin-release-test";
const THIRD = "@someone-else/plugin-release-test";
const COMMIT = "abc1234";
const made: string[] = [];

const hash = () => `sha256:${randomBytes(32).toString("hex")}`;
const version = () => `0.${Math.floor(Math.random() * 1e6)}.${Math.floor(Math.random() * 1e6)}`;

async function entry(pkg: string, v: string, h: string): Promise<string> {
  const [row] = (await localRest("plugin_catalog?select=id", {
    method: "POST",
    body: JSON.stringify({
      package: pkg,
      version: v,
      hash: h,
      display_name: "Release test",
      plugin: "release_test",
      process_type: "civic.release_test",
      capabilities: {
        activities: { emit: [], listen: [] },
        state: { read: [], write: [], tables: [] },
        adapters: [],
        network: { egress: [] },
        identity: { claims: [] },
        ui: { surfaces: [] },
      },
      conformance: { result: "passed", ran_at: new Date().toISOString() },
      status: "pending",
      auto_install: false,
    }),
  })) as Array<{ id: string }>;
  made.push(row!.id);
  return row!.id;
}

function release(body: unknown, bearer: string | null = SECRET ?? null): Promise<{ status: number; body: any }> {
  const url = new URL(`${API_BASE}/control/plugins/release-approve`);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          Host: CONSOLE_HOST,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "X-Civic-Console": "1",
          "X-Forwarded-For": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function row(id: string) {
  const [r] = (await localRest(`plugin_catalog?id=eq.${id}&select=status,approved_by,signature_key,notes`)) as Array<{
    status: string;
    approved_by: string | null;
    signature_key: string | null;
    notes: string | null;
  }>;
  return r!;
}

afterAll(async () => {
  if (!made.length) return;
  const now = new Date().toISOString();
  await localRest(`plugin_catalog?id=in.(${made.join(",")})&status=eq.approved`, {
    method: "PATCH",
    body: JSON.stringify({ status: "withdrawn", withdrawn_at: now }),
  });
  await localRest(`plugin_catalog?id=in.(${made.join(",")})&status=eq.pending`, {
    method: "PATCH",
    body: JSON.stringify({ status: "withdrawn", approved_by: "operator@example.test", approved_at: now, withdrawn_at: now }),
  });
});

describe.skipIf(!SECRET)("a release's approval of first-party entries", () => {
  it("refuses without the release secret, or with another", async () => {
    const id = await entry(FIRST, version(), hash());
    expect((await release({ commit: COMMIT, entries: [{ package: FIRST, version: "0.0.1", hash: hash() }] }, null)).status).toBe(401);
    expect((await release({ commit: COMMIT, entries: [{ package: FIRST, version: "0.0.1", hash: hash() }] }, "not-the-secret")).status).toBe(401);
    expect((await row(id)).status).toBe("pending");
  });

  it("green and matching: approved by release at the commit, and signed as the console signs", async () => {
    const v = version();
    const h = hash();
    const id = await entry(FIRST, v, h);
    const res = await release({ commit: COMMIT, entries: [{ package: FIRST, version: v, hash: h }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.entries).toEqual([expect.objectContaining({ package: FIRST, version: v, result: "approved", id })]);
    const after = await row(id);
    expect(after.status).toBe("approved");
    expect(after.approved_by).toBe(`release@${COMMIT}`);
    expect(after.notes).toContain(`Approved by release at ${COMMIT}`);
    const health = (await (await fetch(`${API_BASE}/health`)).json()) as { plugins?: { signatures?: { key?: string } } };
    if (health.plugins?.signatures?.key) expect(after.signature_key).toBe(health.plugins.signatures.key);
    const audit = await consoleSql<{ actor_email: string; after: { confirmed: string } }>(
      "select action, actor_email, after from console.control_audit_log where action = 'plugin.approve' and after->>'id' = $1",
      [id],
    );
    expect(audit).toEqual([expect.objectContaining({ actor_email: `release@${COMMIT}`, after: expect.objectContaining({ confirmed: "release" }) })]);
  });

  it("a fingerprint that is not the catalog's stays pending, saying both", async () => {
    const v = version();
    const h = hash();
    const id = await entry(FIRST, v, h);
    const other = hash();
    const res = await release({ commit: COMMIT, entries: [{ package: FIRST, version: v, hash: other }] });
    expect(res.status).toBe(200);
    expect(res.body.entries[0].result).toBe("pending");
    expect(res.body.entries[0].reason).toContain("is not the one CI tested");
    expect(res.body.entries[0].reason).toContain(h);
    expect(res.body.entries[0].reason).toContain(other);
    expect((await row(id)).status).toBe("pending");
  });

  it("a third-party entry always waits for the operator", async () => {
    const v = version();
    const h = hash();
    const id = await entry(THIRD, v, h);
    const res = await release({ commit: COMMIT, entries: [{ package: THIRD, version: v, hash: h }] });
    expect(res.status).toBe(200);
    expect(res.body.entries[0]).toEqual(expect.objectContaining({ result: "pending", reason: expect.stringContaining("Not a first-party package") }));
    expect((await row(id)).status).toBe("pending");
  });

  it("refuses a body that is not a release", async () => {
    expect((await release({ commit: "main", entries: [] })).status).toBe(400);
  });
});
