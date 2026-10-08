// Invite codes and the start page (session 4b, 2026-10-08): the parts that
// need no database. The flow itself is tests/api/startPage.test.ts.

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INVITE_DAYS,
  entitlementStatus,
  generateInviteCode,
  hashInviteCode,
  normalizeInviteCode,
  parseMintInput,
} from "../../src/control/entitlements.js";
import { isConsoleHost, isStartHost, startHostname, startHubDomain } from "../../src/control/config.js";
import { startCreateBody } from "../../src/control/startRouter.js";
import { hubSlugRejectionReason } from "../../src/models/hub.js";

const saved = { start: process.env.CIVIC_START_HOSTNAME, console: process.env.CIVIC_CONSOLE_HOSTNAME };
afterEach(() => {
  process.env.CIVIC_START_HOSTNAME = saved.start;
  process.env.CIVIC_CONSOLE_HOSTNAME = saved.console;
});

describe("invite codes", () => {
  it("are three groups of four, without the letters people misread", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
  });

  it("are not repeated", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateInviteCode()));
    expect(seen.size).toBe(2000);
  });

  it("read loosely: case, spaces and hyphens, O as 0, I and L as 1", () => {
    expect(normalizeInviteCode("ab0c-1dEf-GH2J")).toBe("AB0C1DEFGH2J");
    expect(normalizeInviteCode(" abOc 1def ghZj ")).toBe("AB0C1DEFGHZJ");
    expect(normalizeInviteCode("ABIC-LDEF-GH2J")).toBe("AB1C1DEFGH2J");
  });

  it("refuse anything that cannot be a code", () => {
    for (const bad of ["", "ABCD-EFGH", "ABCD-EFGH-JKMNP", "ABCD-EFGH-JKU0", "ABCD-EFGH-JK!0", null, 42]) {
      expect(normalizeInviteCode(bad)).toBeNull();
    }
  });

  it("hash the same however typed, and never to the code itself", () => {
    const code = generateInviteCode();
    const h = hashInviteCode(normalizeInviteCode(code)!);
    expect(hashInviteCode(normalizeInviteCode(code.toLowerCase().replace(/-/g, " "))!)).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(code.replace(/-/g, "").toLowerCase());
  });
});

describe("an entitlement's status", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  it("is unused, used, expired or revoked, the operator's act first", () => {
    expect(entitlementStatus({ revoked_at: null, used: 0, quantity: 1, expires_at: future })).toBe("unused");
    expect(entitlementStatus({ revoked_at: null, used: 1, quantity: 1, expires_at: future })).toBe("used");
    expect(entitlementStatus({ revoked_at: null, used: 0, quantity: 1, expires_at: past })).toBe("expired");
    expect(entitlementStatus({ revoked_at: past, used: 0, quantity: 1, expires_at: past })).toBe("revoked");
    expect(entitlementStatus({ revoked_at: null, used: 1, quantity: 1, expires_at: past })).toBe("used");
  });
});

describe("minting", () => {
  it("defaults to 14 days and no note", () => {
    expect(parseMintInput({})).toEqual({ note: null, days: DEFAULT_INVITE_DAYS });
    expect(DEFAULT_INVITE_DAYS).toBe(14);
  });
  it("takes a note and a lifetime of 1 to 90 days", () => {
    expect(parseMintInput({ note: "  Sam  ", days: 30 })).toEqual({ note: "Sam", days: 30 });
    for (const days of [0, 91, 2.5, "x"]) expect(() => parseMintInput({ days })).toThrow(/1 to 90 days/);
  });
});

describe("the start page's hostname", () => {
  it("is CIVIC_START_HOSTNAME; unset means no start page", () => {
    delete process.env.CIVIC_START_HOSTNAME;
    expect(startHostname()).toBeNull();
    expect(isStartHost("start.civic.social")).toBe(false);
    expect(startHubDomain()).toBeNull();
  });

  it("answers its own host only, port and case aside", () => {
    process.env.CIVIC_START_HOSTNAME = "start.dev.civic.social";
    process.env.CIVIC_CONSOLE_HOSTNAME = "console.dev.civic.social";
    expect(isStartHost("start.dev.civic.social")).toBe(true);
    expect(isStartHost("START.dev.civic.social:443")).toBe(true);
    for (const other of ["start.civic.social", "athens.dev.civic.social", "console.dev.civic.social", "", undefined]) {
      expect(isStartHost(other)).toBe(false);
    }
    expect(isConsoleHost("start.dev.civic.social")).toBe(false);
  });

  it("puts hubs under its own parent", () => {
    process.env.CIVIC_START_HOSTNAME = "start.civic.social";
    expect(startHubDomain()).toBe("civic.social");
    process.env.CIVIC_START_HOSTNAME = "start.dev.civic.social";
    expect(startHubDomain()).toBe("dev.civic.social");
    process.env.CIVIC_START_HOSTNAME = "start.localhost";
    expect(startHubDomain()).toBe("localhost");
  });
});

describe("the start page's form → create input", () => {
  const email = "sam@example.test";

  it("fixes what a visitor may not choose: demo, the address, the admin", () => {
    const body = startCreateBody(
      { slug: "Northside", name: "Northside Civic Hub", hub_kind: "issue", mode: "live", hostname: "evil.example.com", admin_email: "x@example.test" },
      email,
      "dev.civic.social",
    );
    expect(body).toMatchObject({
      slug: "northside",
      hostname: "northside.dev.civic.social",
      mode: "demo",
      admin_email: email,
      hub_kind: "issue",
      sample_content: true,
    });
    expect(body.plugins).toBeUndefined();
  });

  it("makes the contact address the creator's unless given, and the operator only when given", () => {
    expect(startCreateBody({ slug: "a1" }, email, "x.test").ownership).toEqual({ "legal.contact_email": email });
    expect(startCreateBody({ slug: "a1", operator_name: "The Group", contact_email: "hi@example.test" }, email, "x.test").ownership).toEqual({
      "legal.operator_name": "The Group",
      "legal.contact_email": "hi@example.test",
    });
  });

  it("gives no address without a slug", () => {
    expect(startCreateBody({}, email, "civic.social").hostname).toBe("");
  });
});

describe("start is reserved", () => {
  it("cannot be a hub's slug", () => {
    expect(hubSlugRejectionReason("start")).toMatch(/reserved \(the start page/);
  });
});
