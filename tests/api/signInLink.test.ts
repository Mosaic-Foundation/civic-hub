// The sign-in slice (2026-10-14): the "Sign in" link in the code email, and
// "Keep me signed in".
//
// The link is the same code presented another way: its token's hash sits
// beside the code's in sign_in_codes, and it is checked through the same
// attempt function, so it works once, dies with its code (expired or burned),
// and spends nothing else. A session lasts 7 days, or 90 when the person
// ticks "Keep me signed in".
//
// On Athens (a demo hub), with addresses of this file's own. A link is a real
// code, so even there it makes a "code" session.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, plantHubCode } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const run = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const token = (n: number) => `link-${run}-${n}-${"x".repeat(32)}`;

async function session(tokenValue: string): Promise<{ assurance: string; expires_at: string }> {
  const rows = (await localRest(
    `sessions?select=assurance,expires_at&hub_id=eq.athens&token=eq.${sha256(tokenValue)}`,
  )) as Array<{ assurance: string; expires_at: string }>;
  return rows[0]!;
}

function lastsAbout(expiresAt: string, days: number): void {
  const left = Date.parse(expiresAt) - Date.now();
  expect(left).toBeGreaterThan(days * DAY - 60_000);
  expect(left).toBeLessThanOrEqual(days * DAY);
}

describe("the email's Sign in link", () => {
  it("signs its address in once, as a code session", async () => {
    const email = `link-once-${run}@example.test`;
    await plantHubCode("athens", email, "402913", { linkToken: token(1) });
    const res = await call("POST", "/auth/verify-link", ATHENS, { token: token(1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect((await session(res.body.token)).assurance).toBe("code");

    const again = await call("POST", "/auth/verify-link", ATHENS, { token: token(1) });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("link_unusable");
    expect(again.body.error).toBe("This sign-in link has expired or has already been used. Ask for a new code.");
    // Its code went with it: one row, spent.
    expect(await localRest(`sign_in_codes?hub_id=eq.athens&email=eq.${encodeURIComponent(email)}`)).toEqual([]);
  });

  it("dies when its code expires", async () => {
    const email = `link-late-${run}@example.test`;
    await plantHubCode("athens", email, "402914", { linkToken: token(2), expiresInMs: -1000 });
    expect((await call("POST", "/auth/verify-link", ATHENS, { token: token(2) })).body.code).toBe("link_unusable");
  });

  it("dies when wrong guesses burn its code", async () => {
    const email = `link-burned-${run}@example.test`;
    await plantHubCode("athens", email, "402915", { linkToken: token(3), attempts: 5 });
    expect((await call("POST", "/auth/verify-link", ATHENS, { token: token(3) })).body.code).toBe("link_unusable");
  });

  it("refuses a token nobody was sent, and an empty one", async () => {
    expect((await call("POST", "/auth/verify-link", ATHENS, { token: token(99) })).body.code).toBe("link_unusable");
    expect((await call("POST", "/auth/verify-link", ATHENS, {})).body.code).toBe("link_unusable");
  });

  it("works only on the hub that sent it", async () => {
    const email = `link-hub-${run}@example.test`;
    await plantHubCode("athens", email, "402916", { linkToken: token(4) });
    expect((await call("POST", "/auth/verify-link", "floyd.localhost", { token: token(4) })).body.code).toBe("link_unusable");
    expect((await call("POST", "/auth/verify-link", ATHENS, { token: token(4) })).status).toBe(200);
  });
});

describe("Keep me signed in", () => {
  it("a session lasts 7 days, or 90 when ticked, by link or by code", async () => {
    const a = `keep-a-${run}@example.test`;
    await plantHubCode("athens", a, "402917", { linkToken: token(5) });
    const off = await call("POST", "/auth/verify-link", ATHENS, { token: token(5) });
    lastsAbout((await session(off.body.token)).expires_at, 7);

    const b = `keep-b-${run}@example.test`;
    await plantHubCode("athens", b, "402918", { linkToken: token(6) });
    const on = await call("POST", "/auth/verify-link", ATHENS, { token: token(6), keep_signed_in: true });
    lastsAbout((await session(on.body.token)).expires_at, 90);

    // Typed (a demo hub's any six digits), ticked.
    const c = `keep-c-${run}@example.test`;
    await call("POST", "/auth/request-code", ATHENS, { email: c });
    const typed = await call("POST", "/auth/verify", ATHENS, { email: c, code: "123456", keep_signed_in: true });
    expect(typed.status, JSON.stringify(typed.body)).toBe(200);
    lastsAbout((await session(typed.body.token)).expires_at, 90);
  });

  it("only a literal true ticks it", async () => {
    const d = `keep-d-${run}@example.test`;
    await plantHubCode("athens", d, "402919", { linkToken: token(7) });
    const res = await call("POST", "/auth/verify-link", ATHENS, { token: token(7), keep_signed_in: "yes" });
    lastsAbout((await session(res.body.token)).expires_at, 7);
  });
});
