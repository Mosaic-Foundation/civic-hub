// @civic-raw-client-importer: the start page's codes, sessions and rate-limit counters are platform data, held before any hub exists.
// The start page's sign-in (session 4b, 2026-10-08): a session opened by a
// good invite code, then an emailed code to whatever address the person
// gives, then the create.
//
// The code's rules (lifetime, throttle, wrong-guess cap, lockout, the email
// itself) are a hub's, from src/modules/civic.auth/otp.ts, as the console's
// are. Codes and session tokens are stored only as SHA-256 hashes, in
// `platform_sign_in_codes` and `start_sessions` (platform tables, deny-all RLS).
//
// Rate limits live in the database, so they hold across serverless
// instances: by IP for every step, and by email for code requests. IPs and
// emails are stored hashed. Since Audit 2 (2026-10-11) they go through the
// platform's one limiter (src/db/rateLimit.ts, rate_limit_take), which counts
// and records in one transaction; start_attempts, which counted and then
// inserted from here, was dropped by Audit 3.

import { env } from "../config/env.js";
import { CivicError, codeForStatus } from "../errors/index.js";
import { getDb } from "../db/client.js";
import { HOUR_MS, rateLimitBucket, takeRateLimit } from "../db/rateLimit.js";
import { randomToken, sha256Hex } from "../utils/hash.js";
import { sendEmail } from "../utils/email.js";
import { renderCodeEmail } from "../modules/civic.auth/otp.js";
import { checkCode, issueCode } from "../modules/civic.auth/codeRules.js";
import { platformCodeStore, platformRealm } from "./platformCodes.js";

/** Long enough to fill in the form; the hub is the point, not this page. */
export const START_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const START_CODE_SENT = "A code is on its way. It lasts ten minutes.";

export class StartError extends CivicError {
  constructor(message: string, status = 400) {
    super(status, codeForStatus(status), message);
  }
}

const sha256 = sha256Hex;

const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

export function normalizeStartEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) throw new StartError("Enter your email address.");
  return email;
}

// --- Rate limits ---------------------------------------------------------------

/**
 * Per IP per hour. `invite` counts every invite code typed (right or wrong);
 * `request_code` every emailed code asked for; `verify` every emailed code
 * typed; `create` every create submitted. The per-address rules for emailed
 * codes are codeRules.ts's (since the sign-in slice, 2026-10-14).
 */
export const START_LIMITS = {
  invite: { ip: 10 },
  request_code: { ip: 6 },
  verify: { ip: 20 },
  create: { ip: 10 },
} as const;
export type StartStep = keyof typeof START_LIMITS;

export const TOO_MANY = "Too many tries from here. Wait an hour and try again.";

export { clientIp } from "../utils/clientIp.js";

/** The bucket a step's IP or address is counted in (exported for tests). */
export function startBucket(step: StartStep, by: "ip" | "email", value: string): string {
  return rateLimitBucket(`start.${step}`, by, value);
}

/**
 * Count this attempt, or refuse it (429) when the hour's limit is reached.
 * A refused attempt is not counted, so waiting is enough to get back in.
 */
export async function rateLimit(step: StartStep, ip: string, email?: string): Promise<void> {
  const limits = START_LIMITS[step] as { ip: number; email?: number };
  const checks = [{ scope: `start.${step}`, by: "ip", value: ip, limit: limits.ip, windowMs: HOUR_MS }];
  if (email && limits.email !== undefined) {
    checks.push({ scope: `start.${step}`, by: "email", value: email, limit: limits.email, windowMs: HOUR_MS });
  }
  const refused = await takeRateLimit(checks);
  if (refused) throw new StartError(TOO_MANY, 429);
}

// --- Sessions ------------------------------------------------------------------

export interface StartSession {
  token_hash: string;
  email: string | null;
  entitlement_id: string;
  expires_at: string;
}

/** Open a session for a good invite code. Returns the token, which is never stored. */
export async function openStartSession(entitlementId: string): Promise<string> {
  const token = randomToken();
  const { error } = await getDb().from("start_sessions").insert({
    token_hash: sha256(token),
    entitlement_id: entitlementId,
    expires_at: new Date(Date.now() + START_SESSION_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`start_sessions write failed: ${error.message}`);
  return token;
}

export async function startSessionFromToken(token: string | undefined): Promise<StartSession | null> {
  if (!token) return null;
  const { data, error } = await getDb()
    .from("start_sessions")
    .select("token_hash, email, entitlement_id, expires_at, revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as StartSession & { revoked_at: string | null };
  if (row.revoked_at || Date.now() > Date.parse(row.expires_at)) return null;
  return { token_hash: row.token_hash, email: row.email, entitlement_id: row.entitlement_id, expires_at: row.expires_at };
}

async function setSessionEmail(session: StartSession, email: string): Promise<void> {
  const { error } = await getDb().from("start_sessions").update({ email }).eq("token_hash", session.token_hash);
  if (error) throw new Error(`start_sessions write failed: ${error.message}`);
}

export async function endStartSession(session: StartSession): Promise<void> {
  await getDb()
    .from("start_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", session.token_hash);
}

// --- The emailed code ------------------------------------------------------------

function startRealm(timeZone: unknown) {
  return platformRealm("start", { request: START_LIMITS.request_code.ip, verify: START_LIMITS.verify.ip }, timeZone);
}

/**
 * Email a sign-in code. The platform sends it (RESEND_FROM), not any hub.
 * The rules are a hub's (codeRules.ts): the IP's requests, up to three live
 * codes, one email a minute and ten new codes an hour per address.
 */
export async function requestStartCode(email: string, ip: string, timeZone?: unknown): Promise<string> {
  const { code } = await issueCode(platformCodeStore("start", "sign_in"), startRealm(timeZone), ip, email);
  const rendered = renderCodeEmail(code, "Civic Social", "start your hub");
  const result = await sendEmail({
    to: email,
    subject: "Your Civic Social code",
    html: rendered.html,
    text: rendered.text,
  });
  if (!result.sent) {
    console.warn(`[start] code email NOT sent (${result.error}).`);
    // As a hub's sign-in: the code reaches the log only when there is no
    // mailer at all, which is local development.
    if (!env.RESEND_API_KEY) console.log(`\n[start] sign-in code for ${email}: ${code}\n`);
    if (env.RESEND_API_KEY) throw new StartError("The code could not be sent. Try again in a minute.", 502);
  }
  return START_CODE_SENT;
}

/**
 * Check the emailed code and spend it; the session is now this address's.
 * Same rules as a hub's (codeRules.ts): expiry, tries that burn the code,
 * single use, and the IP's checks.
 */
export async function verifyStartCode(session: StartSession, email: string, rawCode: unknown, ip: string, timeZone?: unknown): Promise<void> {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new StartError("Enter the six-digit code.");
  await checkCode(platformCodeStore("start", "sign_in"), startRealm(timeZone), ip, { email, code });
  await setSessionEmail(session, email);
}
