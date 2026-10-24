// The emailed code's rules: lock the code, not the person.
//
// Adam's decision (2026-10-13, sign-in slice). Too many wrong guesses burn
// that one code: it stops working, and the owner asks for a fresh one.
// Nothing ever locks an address, so nobody can keep someone else out by
// guessing wrong on purpose.
//
//   A code      six digits, works for ten minutes, burned after five tries.
//   An address  up to three live codes at once. Asking again sends a new code
//               and the earlier ones keep working, so a stranger who asks for
//               codes can't make the owner's stop working; a fourth request
//               while three are live is refused with a time (every code we
//               sent is already in the owner's inbox). At most one email a
//               minute and ten new codes an hour.
//   A guess     checked against every live code of the address, and costs a
//               try on each, so three live codes never mean three times the
//               guesses: an address faces at most 10 x 5 = 50 tries an hour,
//               however many machines guess.
//   An IP       the per-network caps of each realm (requests and checks an
//               hour), and at most five wrong tries an hour at any one
//               address, so one machine can burn at most one round of that
//               person's codes an hour.
//
// A link in the email is a second way to present the same code: its own long
// random token, whose hash sits beside the code's, checked through the same
// attempt function with the same expiry, tries and single use.
//
// One implementation for a hub's sign-in and step-up, the console and the
// start page; each passes its own store (where its codes are kept) and realm
// (its bucket names, per-IP caps and time zone).

import { RateLimitedError, ValidationError } from "../../errors/index.js";
import type { RateLimitCheck } from "../../db/rateLimit.js";
import { randomToken, sameHexHash, sha256Hex } from "../../utils/hash.js";
import { resolveTimeZone } from "../../utils/hubTime.js";
import { generateOTP, OTP_TTL_MS } from "./otp.js";
import { authStore } from "./store.js";

export const HOUR_MS = 60 * 60 * 1000;

export const CODE_RULES = {
  ttlMs: OTP_TTL_MS,
  /** Tries a code takes before it is burned. */
  maxTries: 5,
  liveCodesPerAddress: 3,
  /** One email a minute per address. */
  emailGapMs: 60 * 1000,
  newCodesPerHour: 10,
  /** Wrong tries one IP may make at one address in an hour. */
  wrongTriesPerIpPerAddress: 5,
} as const;

/** One stored code, as the attempt function returns it. */
export interface CodeRow {
  id: string;
  email: string;
  code_hash: string;
  link_hash: string | null;
  attempts: number;
  expires_at: string;
}

/** Where a realm keeps its codes. */
export interface CodeStore {
  /** Expiry times of the address's live codes (unexpired, under maxTries). */
  live(email: string): Promise<string[]>;
  insert(row: { email: string; code_hash: string; link_hash: string | null; expires_at: string }): Promise<void>;
  /** Spend one try on every live code the guess is checked against (take_*_sign_in_attempt). */
  take(by: { email: string } | { linkHash: string }, maxTries: number): Promise<CodeRow[]>;
  /** Delete the code: the spend. False when another request spent it first. */
  spend(id: string): Promise<boolean>;
  /** Every code of the address (a demo sign-in, which proves nothing, clears them). */
  clear?(email: string): Promise<void>;
}

export interface Realm {
  /** Bucket prefix: "hub", "console", "start". */
  scope: string;
  /** What an address is counted by: a hub's are per hub, as accounts are. */
  addressKey(email: string): string;
  /** Per IP per hour. A null request cap: the caller counted the request itself. */
  ipLimits: { request: number | null; verify: number };
  /** For "Try again after 4:10 PM". */
  timeZone: string;
  /** Whether codes come with a sign-in link. */
  links: boolean;
}

export interface IssuedCode {
  code: string;
  /** The link's token, when the realm has links. Never stored. */
  linkToken: string | null;
  expiresAt: string;
}

// --- Messages ------------------------------------------------------------------

/** "4:10 PM" in the zone; "4:10 PM UTC" when the zone is UTC (no hub zone set). */
export function clockTime(at: Date, timeZone: string): string {
  const zone = resolveTimeZone(timeZone);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at);
  return zone === "UTC" ? `${t} UTC` : t;
}

export function tooManyMessage(at: Date, timeZone: string): string {
  return `Too many attempts. Try again after ${clockTime(at, timeZone)}.`;
}

export const WRONG_CODE = "That code isn't right. Check it and try again.";
export const BURNED_CODE = "That code has stopped working after too many tries. Ask for a new code.";
export const NO_LIVE_CODE = "That code doesn't work any more. Ask for a new code.";
export const LINK_UNUSABLE = "This sign-in link has expired or has already been used. Ask for a new code.";

function refuse(message: string, code: string, at: Date): RateLimitedError {
  return new RateLimitedError(message, code, {
    retryAfterSeconds: Math.max(1, Math.ceil((at.getTime() - Date.now()) / 1000)),
    extra: { retry_at: at.toISOString() },
  });
}

/** Take the checks, or throw "Too many attempts. Try again after …". */
async function take(realm: Realm, checks: RateLimitCheck[], messageFor?: (c: RateLimitCheck, at: Date) => [string, string]): Promise<void> {
  const refused = await authStore.get().takeRateLimit(checks);
  if (!refused) return;
  const at = (await authStore.get().rateLimitRetryAt(refused)) ?? new Date(Date.now() + refused.windowMs);
  const [message, code] = messageFor?.(refused, at) ?? [tooManyMessage(at, realm.timeZone), "rate_limited"];
  throw refuse(message, code, at);
}

// --- Asking for a code ---------------------------------------------------------------

/**
 * Make a new code for the address, or refuse with a time. The caller emails
 * it. Counted in this order: three live codes, then the IP's requests, the
 * address's one email a minute and its ten new codes an hour (one atomic
 * take, so racing requests can't slip past the minute).
 */
export async function issueCode(store: CodeStore, realm: Realm, ip: string, email: string): Promise<IssuedCode> {
  const live = await store.live(email);
  if (live.length >= CODE_RULES.liveCodesPerAddress) {
    const at = new Date(Math.min(...live.map((t) => Date.parse(t))));
    throw refuse(
      `We've sent you three codes that still work. Use one of them, or try again after ${clockTime(at, realm.timeZone)}.`,
      "codes_waiting",
      at,
    );
  }

  const address = realm.addressKey(email);
  const minute: RateLimitCheck = { scope: `${realm.scope}.code_email`, by: "email", value: address, limit: 1, windowMs: CODE_RULES.emailGapMs };
  await take(
    realm,
    [
      ...(realm.ipLimits.request === null
        ? []
        : [{ scope: `${realm.scope}.request_code`, by: "ip", value: ip, limit: realm.ipLimits.request, windowMs: HOUR_MS }]),
      minute,
      { scope: `${realm.scope}.new_code`, by: "email", value: address, limit: CODE_RULES.newCodesPerHour, windowMs: HOUR_MS },
    ],
    (c, at) =>
      c.scope === minute.scope
        ? [`We just sent you a code. You can ask for another after ${clockTime(at, realm.timeZone)}.`, "code_throttled"]
        : [tooManyMessage(at, realm.timeZone), "rate_limited"],
  );

  const code = generateOTP();
  const linkToken = realm.links ? randomToken() : null;
  const expiresAt = new Date(Date.now() + CODE_RULES.ttlMs).toISOString();
  await store.insert({
    email,
    code_hash: sha256Hex(code),
    link_hash: linkToken ? sha256Hex(linkToken) : null,
    expires_at: expiresAt,
  });
  return { code, linkToken, expiresAt };
}

// --- Checking a code ---------------------------------------------------------------

export type Presented = { email: string; code: string } | { linkToken: string };

/**
 * Check a typed code (against every live code of the address) or a link, and
 * spend it. Returns the address it proved. Throws with the message to show.
 */
export async function checkCode(store: CodeStore, realm: Realm, ip: string, presented: Presented): Promise<{ email: string }> {
  await take(realm, [{ scope: `${realm.scope}.verify`, by: "ip", value: ip, limit: realm.ipLimits.verify, windowMs: HOUR_MS }]);

  if ("linkToken" in presented) {
    const token = presented.linkToken.trim();
    if (!token) throw new ValidationError(LINK_UNUSABLE, "link_unusable");
    const linkHash = sha256Hex(token);
    const [row] = await store.take({ linkHash }, CODE_RULES.maxTries);
    if (!row || !row.link_hash || !sameHexHash(row.link_hash, linkHash)) throw new ValidationError(LINK_UNUSABLE, "link_unusable");
    if (!(await store.spend(row.id))) throw new ValidationError(LINK_UNUSABLE, "link_unusable");
    return { email: row.email };
  }

  const email = presented.email;
  const code = presented.code.trim();
  const wrongBucket: RateLimitCheck = {
    scope: `${realm.scope}.wrong_code`,
    by: "ip_email",
    value: `${ip}|${realm.addressKey(email)}`,
    limit: CODE_RULES.wrongTriesPerIpPerAddress,
    windowMs: HOUR_MS,
  };
  // Refused before a try is spent, so a machine over its wrong tries at this
  // address can't burn the owner's codes.
  const wait = await authStore.get().rateLimitRetryAt(wrongBucket);
  if (wait) throw refuse(tooManyMessage(wait, realm.timeZone), "rate_limited", wait);

  const rows = await store.take({ email }, CODE_RULES.maxTries);
  if (rows.length === 0) throw new ValidationError(NO_LIVE_CODE, "no_live_code");

  const hash = sha256Hex(code);
  const match = rows.find((r) => sameHexHash(r.code_hash, hash));
  if (!match) {
    // A wrong try only: counted after the fact (a refusal here records nothing
    // and changes nothing; the check above is what holds the line).
    await authStore.get().takeRateLimit([wrongBucket]);
    if (rows.every((r) => r.attempts >= CODE_RULES.maxTries)) throw new ValidationError(BURNED_CODE, "code_burned");
    throw new ValidationError(WRONG_CODE, "invalid_code");
  }
  if (!(await store.spend(match.id))) throw new ValidationError(NO_LIVE_CODE, "no_live_code");
  return { email: match.email };
}

/** The bucket name, for tests that read rate_limit_hits. */
export function codeBucket(realm: Pick<Realm, "scope">, step: string, by: string, value: string): string {
  return authStore.get().rateLimitBucket(`${realm.scope}.${step}`, by, value);
}
