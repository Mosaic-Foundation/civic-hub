import { describe, it, expect } from "vitest";
import { request } from "node:http";
import { API_BASE } from "../fixtures/helpers.js";

/**
 * Who may see and change a hub's admin roster, over HTTP.
 *
 * WHAT THESE CANNOT COVER, and why the guards have their own unit tests: a
 * successful roster change needs a real one-time code, and this layer speaks
 * HTTP only — it cannot read `pending_verifications`. An Athens admin cannot
 * take the demo shortcut either, precisely because privileged accounts always
 * get a real emailed code, so there is no admin token to be had here. So this
 * file covers the boundary (who is refused, and with what) and
 * tests/unit/hubPeopleGuards.test.ts covers what happens past it.
 *
 * node:http rather than fetch: the hostname is the variable under test and
 * `Host` is a forbidden header for fetch.
 */
const ATHENS = "athens.localhost";

function call(
  method: string,
  path: string,
  host: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  const url = new URL(`${API_BASE}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          Accept: "application/json",
          Host: host,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
          } catch {
            reject(new Error(`unparseable (${res.statusCode}): ${raw.slice(0, 120)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** An ordinary visitor on the demo hub, where any six digits are accepted. */
async function signInAsVisitor(): Promise<string> {
  const email = `roster-visitor-${Date.now()}@example.com`;
  await call("POST", "/auth/request-code", ATHENS, { email });
  const { body } = await call("POST", "/auth/verify", ATHENS, {
    email,
    code: "123456",
  });
  return body.token as string;
}

describe("the admin roster is admin-only", () => {
  it("refuses an anonymous reader", async () => {
    const { status } = await call("GET", "/admin/hub/people", ATHENS);
    expect(status).toBe(401);
  });

  it("refuses an anonymous writer", async () => {
    const { status } = await call("POST", "/admin/hub/people", ATHENS, {
      admin_emails: ["attacker@example.com"],
      code: "123456",
    });
    expect(status).toBe(401);
  });

  it("refuses a signed-in visitor who is not an admin", async () => {
    // The case that matters on a demo hub: anyone may sign in with any six
    // digits, so "signed in" must be nowhere near enough to grant admin.
    const token = await signInAsVisitor();
    const read = await call("GET", "/admin/hub/people", ATHENS, undefined, token);
    expect(read.status).toBe(403);

    const write = await call(
      "POST",
      "/admin/hub/people",
      ATHENS,
      { admin_emails: ["attacker@example.com"], code: "123456" },
      token,
    );
    expect(write.status).toBe(403);
  });

  it("does not leak the roster in the error body", async () => {
    const { body } = await call("GET", "/admin/hub/people", ATHENS);
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it("refuses a code request from a visitor", async () => {
    // Otherwise the step-up becomes a way to make the hub send mail to an
    // arbitrary address on demand.
    const token = await signInAsVisitor();
    const { status } = await call(
      "POST",
      "/admin/hub/people/request-code",
      ATHENS,
      {},
      token,
    );
    expect(status).toBe(403);
  });
});
