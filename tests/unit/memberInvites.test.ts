// Members and invites (2026-10-14): what a member types, and the email it
// becomes. Pure; the rules that need a database are in
// tests/api/membersInvites.test.ts.

import { describe, expect, it } from "vitest";
import { cleanMessage, parseAddresses, renderInviteEmail, MAX_ADDRESSES_PER_REQUEST } from "../../src/services/hubInvites.js";
import { avatarSeed } from "../../src/services/members.js";

describe("the addresses a member types", () => {
  it("splits on commas, semicolons, spaces and new lines, lower-cases, and keeps each once", () => {
    expect(parseAddresses(" A@x.org, b@y.org;\nc@z.org  a@X.ORG <d@w.org>")).toEqual(["a@x.org", "b@y.org", "c@z.org", "d@w.org"]);
    expect(parseAddresses(["a@x.org", "b@y.org, c@z.org"])).toEqual(["a@x.org", "b@y.org", "c@z.org"]);
  });

  it("refuses the whole request when one isn't an address, naming it", () => {
    expect(() => parseAddresses("a@x.org, nope")).toThrow(/nope/);
    expect(() => parseAddresses("a@x")).toThrow(/doesn't look like an email address/);
  });

  it("needs at least one, and no more than a day's admin limit", () => {
    expect(() => parseAddresses("  ")).toThrow(/at least one/);
    expect(() => parseAddresses(42)).toThrow(/at least one/);
    const many = Array.from({ length: MAX_ADDRESSES_PER_REQUEST + 1 }, (_, i) => `p${i}@x.org`).join(",");
    expect(() => parseAddresses(many)).toThrow(/Up to 50/);
  });
});

describe("the message", () => {
  it("is trimmed, may be empty, and is limited", () => {
    expect(cleanMessage(undefined)).toBe("");
    expect(cleanMessage("  Hi\r\nthere  ")).toBe("Hi\nthere");
    expect(() => cleanMessage("x".repeat(1001))).toThrow(/under 1000/);
    expect(() => cleanMessage(5)).toThrow(/text/);
  });
});

describe("the invite email", () => {
  const input = {
    hubName: "Example Civic Hub",
    hubUrl: "https://example.test",
    inviterName: "Avery <Lane>",
    message: "Come along!\n\n<script>alert(1)</script>",
    link: "https://example.test/sign-in#invite=abc",
  };

  it("names who invited, carries the message and the one-tap link", () => {
    const m = renderInviteEmail(input);
    expect(m.subject).toBe("Avery <Lane> invited you to Example Civic Hub");
    expect(m.text).toContain("Come along!");
    expect(m.text).toContain("Join Example Civic Hub: https://example.test/sign-in#invite=abc");
    expect(m.html).toContain('href="https://example.test/sign-in#invite=abc"');
    expect(m.text).toContain("won't send you another invite");
  });

  it("escapes what the member wrote", () => {
    const m = renderInviteEmail(input);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Avery &lt;Lane&gt;");
  });

  it("works without a message", () => {
    const m = renderInviteEmail({ ...input, message: "" });
    expect(m.text.split("\n")[2]).toBe("Join Example Civic Hub: https://example.test/sign-in#invite=abc");
  });
});

describe("the avatar seed", () => {
  it("is stable per hub and account, differs between hubs, and is 16 hex characters", () => {
    expect(avatarSeed("a", "user_1")).toBe(avatarSeed("a", "user_1"));
    expect(avatarSeed("a", "user_1")).not.toBe(avatarSeed("b", "user_1"));
    expect(avatarSeed("a", "user_1")).toMatch(/^[0-9a-f]{16}$/);
  });
});
