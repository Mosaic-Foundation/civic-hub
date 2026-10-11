// @civic-raw-client-importer: the start page's codes, sessions and rate-limit counters are platform data, held before any hub exists.
// The start page's sign-in (session 4b, 2026-10-08): a session opened by a
// good invite code, then an emailed code to whatever address the person
// gives, then the create.
//
// The code's rules (lifetime, throttle, wrong-guess cap, lockout, the email
// itself) are a hub's, from src/modules/civic.auth/otp.ts, as the console's
// are. Codes and session tokens are stored only as SHA-256 hashes, in
// `start_codes` and `start_sessions` (platform tables, deny-all RLS).
//
// Rate limits live in the database, so they hold across serverless
// instances: by IP for every step, and by email for code requests. IPs and
// emails are stored hashed. Since Audit 2 (2026-10-11) they go through the
// platform's one limiter (src/db/rateLimit.ts, rate_limit_take), which counts
// and records in one transaction; start_attempts, which counted and then
// inserted from here, is retired.

import { getDb } from "../db/client.js";
import { HOUR_MS, rateLimitBucket, takeRateLimit } from "../db/rateLimit.js";
import { randomToken, sameHexHash, sha256Hex } from "../utils/hash.js";
import { sendEmail } from "../utils/email.js";
import {
  LOCKOUT_MS,
  MAX_VERIFY_ATTEMPTS,
  OTP_TTL_MS,
  REQUEST_THROTTLE_MS,
  generateOTP,
  lockoutMessage,
  renderCodeEmail,
} from "../modules/civic.auth/otp.js";

/** Long enough to fill in the form; the hub is the point, not this page. */
export const START_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const START_CODE_SENT = "A code is on its way. It lasts ten minutes.";

export class StartError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "StartError";
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
 * Per hour. `invite` counts every invite code typed (right or wrong);
 * `request_code` every emailed code asked for, by IP and by address;
 * `verify` every emailed code typed; `create` every create submitted.
 */
export const START_LIMITS = {
  invite: { ip: 10 },
  request_code: { ip: 6, email: 5 },
  verify: { ip: 20 },
  create: { ip: 10 },
} as const;
export type StartStep = keyof typeof START_LIMITS;

export const TOO_MANY = "Too many tries from here. Wait an hour and try again.";
const TOO_MANY_FOR_ADDRESS = "Too many codes for that address. Wait an hour and try again.";

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
  if (refused) throw new StartError(refused.by === "ip" ? TOO_MANY : TOO_MANY_FOR_ADDRESS, 429);
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

interface CodeRow {
  code_hash: string;
  expires_at: string;
  created_at: string;
  attempts: number;
  locked_until: string | null;
}

async function readCode(email: string): Promise<CodeRow | null> {
  const { data, error } = await getDb()
    .from("start_codes")
    .select("code_hash, expires_at, created_at, attempts, locked_until")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`start_codes read failed: ${error.message}`);
  return (data as CodeRow | null) ?? null;
}

/** Email a sign-in code. The platform sends it (RESEND_FROM), not any hub. */
export async function requestStartCode(email: string): Promise<string> {
  const recent = await readCode(email);
  if (recent?.locked_until && Date.now() < Date.parse(recent.locked_until)) {
    throw new StartError(lockoutMessage(recent.locked_until), 429);
  }
  if (recent && Date.now() - Date.parse(recent.created_at) < REQUEST_THROTTLE_MS) {
    throw new StartError("Please wait a moment before asking for another code.", 429);
  }
  const code = generateOTP();
  const now = Date.now();
  const { error } = await getDb().from("start_codes").upsert(
    {
      email,
      code_hash: sha256(code),
      expires_at: new Date(now + OTP_TTL_MS).toISOString(),
      created_at: new Date(now).toISOString(),
      attempts: 0,
      locked_until: null,
    },
    { onConflict: "email" },
  );
  if (error) throw new Error(`start_codes write failed: ${error.message}`);

  const result = await sendEmail({
    to: email,
    subject: "Your Civic Social code",
    html: renderCodeEmail(code, "Civic Social", "start your hub"),
  });
  if (!result.sent) {
    console.warn(`[start] code email NOT sent (${result.error}).`);
    // As a hub's sign-in: the code reaches the log only when there is no
    // mailer at all, which is local development.
    if (!process.env.RESEND_API_KEY) console.log(`\n[start] sign-in code for ${email}: ${code}\n`);
    if (process.env.RESEND_API_KEY) throw new StartError("The code could not be sent. Try again in a minute.", 502);
  }
  return START_CODE_SENT;
}

/**
 * Check the emailed code and spend it; the session is now this address's.
 * Same rules as a hub's consumePendingCode: lockout, expiry, the wrong-guess
 * cap, single use, and one attempt spent atomically before the compare.
 */
export async function verifyStartCode(session: StartSession, email: string, rawCode: unknown): Promise<void> {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new StartError("Enter the six-digit code.");
  const db = getDb();
  const { data: taken, error } = await db.rpc("take_start_code_attempt", {
    p_email: email,
    p_max: MAX_VERIFY_ATTEMPTS,
    p_lock_seconds: Math.round(LOCKOUT_MS / 1000),
  });
  if (error) throw new Error(`take_start_code_attempt failed: ${error.message}`);
  const row = ((taken ?? []) as Array<{ code_hash: string; expires_at: string; attempts: number }>)[0];
  if (!row) {
    const current = await readCode(email);
    if (!current) throw new StartError("No code is waiting for that address. Ask for a new one.", 401);
    if (current.locked_until && Date.now() < Date.parse(current.locked_until)) {
      throw new StartError(lockoutMessage(current.locked_until), 429);
    }
    throw new StartError("That code can no longer be used. Ask for a new one.", 401);
  }
  const spend = () => db.from("start_codes").delete().eq("email", email).eq("code_hash", row.code_hash).select("email");
  if (Date.now() > Date.parse(row.expires_at)) {
    await spend();
    throw new StartError("That code has expired. Ask for a new one.", 401);
  }
  if (!sameHexHash(row.code_hash, sha256(code))) {
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new StartError(lockoutMessage(new Date(Date.now() + LOCKOUT_MS).toISOString()), 429);
    }
    throw new StartError("That code is not right. Check the email and try again.", 401);
  }
  const { data: spent } = await spend(); // a code works once: the delete is the spend
  if (!spent || spent.length === 0) throw new StartError("That code has already been used. Ask for a new one.", 401);
  await setSessionEmail(session, email);
}
