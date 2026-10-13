import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lock the code, not the person (sign-in slice, Adam 2026-10-13).
 *
 * The rules in src/modules/civic.auth/codeRules.ts, against an in-memory
 * store that behaves as take_sign_in_attempt does (a try spent on every live
 * code a guess is checked against) and an in-memory rate limiter with a
 * clock we move. The database versions of both are exercised end to end in
 * tests/api/signInCodes.test.ts.
 */

let now = Date.parse("2026-10-14T20:00:00Z"); // 4:00 PM in New York

const hits: Array<{ bucket: string; at: number }> = [];
const bucketOf = (c: { scope: string; by: string; value: string }) => `${c.scope}:${c.by}:${c.value}`;
type Check = { scope: string; by: string; value: string; limit: number; windowMs: number };
const inWindow = (c: Check) => hits.filter((h) => h.bucket === bucketOf(c) && h.at > now - c.windowMs);

vi.mock("../../src/db/rateLimit.js", async (orig) => ({
  ...(await orig<typeof import("../../src/db/rateLimit.js")>()),
  takeRateLimit: async (checks: Check[]) => {
    const full = checks.find((c) => inWindow(c).length >= c.limit);
    if (full) return full;
    for (const c of checks) hits.push({ bucket: bucketOf(c), at: now });
    return null;
  },
  retryAt: async (c: Check) => {
    const used = inWindow(c).map((h) => h.at).sort((a, b) => b - a);
    return used.length >= c.limit ? new Date(used[c.limit - 1]! + c.windowMs) : null;
  },
}));

const { CODE_RULES, checkCode, issueCode, clockTime } = await import("../../src/modules/civic.auth/codeRules.js");
type CodeStore = import("../../src/modules/civic.auth/codeRules.js").CodeStore;
type Realm = import("../../src/modules/civic.auth/codeRules.js").Realm;
const { sha256Hex } = await import("../../src/utils/hash.js");

interface Stored { id: string; email: string; code_hash: string; link_hash: string | null; attempts: number; expires_at: string }
let rows: Stored[] = [];
let nextId = 1;

const store: CodeStore = {
  async live(email) {
    return rows.filter((r) => r.email === email && Date.parse(r.expires_at) > now && r.attempts < CODE_RULES.maxTries).map((r) => r.expires_at);
  },
  async insert(row) {
    rows.push({ ...row, id: String(nextId++), attempts: 0 });
  },
  async take(by, max) {
    const hit = rows.filter(
      (r) => ("email" in by ? r.email === by.email : r.link_hash === by.linkHash) && r.attempts < max && Date.parse(r.expires_at) > now,
    );
    for (const r of hit) r.attempts += 1;
    return hit.map((r) => ({ ...r }));
  },
  async spend(id) {
    const before = rows.length;
    rows = rows.filter((r) => r.id !== id);
    return rows.length < before;
  },
};

const realm: Realm = {
  scope: "hub",
  addressKey: (e) => `athens:${e}`,
  ipLimits: { request: 20, verify: 40 },
  timeZone: "America/New_York",
  links: true,
};

const OWNER = "owner@example.test";
const OWNER_IP = "198.51.100.7";
const ATTACKER_IP = "203.0.113.66";
const minutes = (n: number) => { now += n * 60_000; };
const wrong = (code: string) => (code === "000000" ? "000001" : "000000");

async function failure(p: Promise<unknown>): Promise<{ code: string; message: string; status: number }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code: string; message: string; status: number };
    return { code: e.code, message: e.message, status: e.status };
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  hits.length = 0;
  rows = [];
  now = Date.parse("2026-10-14T20:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

describe("a code", () => {
  it("lets its owner in once, and not again", async () => {
    const { code } = await issueCode(store, realm, OWNER_IP, OWNER);
    await expect(checkCode(store, realm, OWNER_IP, { email: OWNER, code })).resolves.toEqual({ email: OWNER });
    expect((await failure(checkCode(store, realm, OWNER_IP, { email: OWNER, code }))).code).toBe("no_live_code");
  });

  it("stops working after ten minutes", async () => {
    const { code } = await issueCode(store, realm, OWNER_IP, OWNER);
    minutes(10.5);
    expect((await failure(checkCode(store, realm, OWNER_IP, { email: OWNER, code }))).code).toBe("no_live_code");
  });

  it("is burned by five wrong tries, and the owner just asks for a new one: nothing locks the address", async () => {
    const { code } = await issueCode(store, realm, OWNER_IP, OWNER);
    for (let i = 1; i <= 4; i++) {
      expect((await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: wrong(code) }))).code).toBe("invalid_code");
    }
    const fifth = await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: wrong(code) }));
    expect(fifth.code).toBe("code_burned");
    expect(fifth.message).toBe("That code has stopped working after too many tries. Ask for a new code.");
    // The right code no longer works...
    expect((await failure(checkCode(store, realm, OWNER_IP, { email: OWNER, code }))).code).toBe("no_live_code");
    // ...and a fresh one does, at once (the burned code isn't live, so the
    // minute between emails has passed only if it had: wait it out).
    minutes(1);
    const fresh = await issueCode(store, realm, OWNER_IP, OWNER);
    await expect(checkCode(store, realm, OWNER_IP, { email: OWNER, code: fresh.code })).resolves.toEqual({ email: OWNER });
  });
});

describe("a nuisance attacker", () => {
  it("can't make the owner's code stop working by asking for more codes", async () => {
    const owners = await issueCode(store, realm, OWNER_IP, OWNER);
    minutes(1);
    await issueCode(store, realm, ATTACKER_IP, OWNER);
    minutes(1);
    await issueCode(store, realm, ATTACKER_IP, OWNER);
    minutes(1);
    // A fourth while three are live is refused with a time; nothing is dropped.
    const fourth = await failure(issueCode(store, realm, ATTACKER_IP, OWNER));
    expect(fourth.code).toBe("codes_waiting");
    expect(fourth.message).toBe("We've sent you three codes that still work. Use one of them, or try again after 4:10 PM.");
    await expect(checkCode(store, realm, OWNER_IP, { email: OWNER, code: owners.code })).resolves.toEqual({ email: OWNER });
  });

  it("gets at most one email a minute to the address, with the time to try again", async () => {
    await issueCode(store, realm, ATTACKER_IP, OWNER);
    const again = await failure(issueCode(store, realm, ATTACKER_IP, OWNER));
    expect(again.code).toBe("code_throttled");
    expect(again.message).toBe("We just sent you a code. You can ask for another after 4:01 PM.");
    expect(again.status).toBe(429);
  });

  it("gets at most ten new codes an hour made for the address", async () => {
    let made = 0;
    for (let i = 0; i < 12; i++) {
      try {
        const { code } = await issueCode(store, realm, `203.0.113.${i}`, OWNER);
        made++;
        await checkCode(store, realm, OWNER_IP, { email: OWNER, code }); // spent, so it isn't live
      } catch {
        /* refused */
      }
      minutes(1);
    }
    expect(made).toBe(CODE_RULES.newCodesPerHour);
  });

  it("on one machine can burn at most one round of the owner's codes an hour, and the owner still gets in", async () => {
    const first = await issueCode(store, realm, OWNER_IP, OWNER);
    for (let i = 0; i < 5; i++) await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: wrong(first.code) }));
    minutes(1);
    const second = await issueCode(store, realm, OWNER_IP, OWNER);
    // The attacker's machine is out of wrong tries at this address: refused
    // before a try is spent, so the owner's new code is untouched.
    const refused = await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: wrong(second.code) }));
    expect(refused.message).toMatch(/^Too many attempts\. Try again after \d{1,2}:\d\d PM\.$/);
    expect(rows.find((r) => r.code_hash === sha256Hex(second.code))!.attempts).toBe(0);
    await expect(checkCode(store, realm, OWNER_IP, { email: OWNER, code: second.code })).resolves.toEqual({ email: OWNER });
  });
});

describe("a guesser", () => {
  it("spends a try on every live code with each guess, so three codes don't triple the guesses", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await issueCode(store, realm, OWNER_IP, OWNER)).code);
      minutes(1);
    }
    const guess = ["999999", "999998", "999997", "999996"].find((g) => !codes.includes(g))!;
    expect((await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: guess }))).code).toBe("invalid_code");
    expect(rows.map((r) => r.attempts)).toEqual([1, 1, 1]);
  });

  it("with many machines faces at most 10 codes x 5 tries = 50 tries at one address an hour", async () => {
    let tries = 0;
    for (let i = 0; i < 60; i++) {
      const ip = `192.0.2.${i}`;
      try {
        await issueCode(store, realm, ip, OWNER);
      } catch {
        /* the address's caps */
      }
      for (let g = 0; g < 5; g++) {
        const before = rows.reduce((n, r) => n + r.attempts, 0);
        try {
          await checkCode(store, realm, ip, { email: OWNER, code: String(100000 + i * 5 + g) });
        } catch {
          /* wrong */
        }
        tries += rows.reduce((n, r) => n + r.attempts, 0) - before;
      }
      minutes(1);
    }
    expect(tries).toBeLessThanOrEqual(CODE_RULES.newCodesPerHour * CODE_RULES.maxTries);
  });

  it("on one machine gets five tries at an address an hour", async () => {
    await issueCode(store, realm, OWNER_IP, OWNER);
    for (let i = 0; i < 5; i++) await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: String(200000 + i) }));
    expect((await failure(checkCode(store, realm, ATTACKER_IP, { email: OWNER, code: "200009" }))).code).toBe("rate_limited");
  });
});

describe("the email's link", () => {
  it("signs its address in once, through the same tries and expiry", async () => {
    const { linkToken } = await issueCode(store, realm, OWNER_IP, OWNER);
    await expect(checkCode(store, realm, OWNER_IP, { linkToken: linkToken! })).resolves.toEqual({ email: OWNER });
    expect((await failure(checkCode(store, realm, OWNER_IP, { linkToken: linkToken! }))).code).toBe("link_unusable");
  });

  it("dies with its code: burned or expired", async () => {
    const burned = await issueCode(store, realm, OWNER_IP, OWNER);
    for (let i = 0; i < 5; i++) await failure(checkCode(store, realm, `192.0.2.${i}`, { email: OWNER, code: wrong(burned.code) }));
    expect((await failure(checkCode(store, realm, OWNER_IP, { linkToken: burned.linkToken! }))).code).toBe("link_unusable");
    minutes(1);
    const late = await issueCode(store, realm, OWNER_IP, OWNER);
    minutes(11);
    expect((await failure(checkCode(store, realm, OWNER_IP, { linkToken: late.linkToken! }))).code).toBe("link_unusable");
  });

  it("is a code's sibling, not a way around it: an unknown token is refused", async () => {
    await issueCode(store, realm, OWNER_IP, OWNER);
    expect((await failure(checkCode(store, realm, OWNER_IP, { linkToken: "not-a-token" }))).code).toBe("link_unusable");
  });
});

describe("the time in a message", () => {
  it("is the hub's clock, and says UTC when the hub has no zone", () => {
    const at = new Date("2026-10-14T20:10:00Z");
    expect(clockTime(at, "America/New_York")).toBe("4:10 PM");
    expect(clockTime(at, "America/Los_Angeles")).toBe("1:10 PM");
    expect(clockTime(at, "")).toBe("8:10 PM UTC");
  });
});
