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
// Rate limits live in the database (`start_attempts`), so they hold across
// serverless instances: by IP for every step, and by email for code
// requests. IPs and emails are stored hashed.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { getDb } from "../db/client.js";
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

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

const WINDOW_MS = 60 * 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export const TOO_MANY = "Too many tries from here. Wait an hour and try again.";
const TOO_MANY_FOR_ADDRESS = "Too many codes for that address. Wait an hour and try again.";

/**
 * The caller's IP: Vercel's x-forwarded-for, first hop (Vercel sets the
 * header itself, so a client cannot choose it there); locally, the socket.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = typeof fwd === "string" ? fwd.split(",")[0]!.trim() : "";
  return first || req.ip || "unknown";
}

function bucket(step: StartStep, by: "ip" | "email", value: string): string {
  return `${step}:${by}:${sha256(`civic-start:${value}`)}`;
}

async function countSince(key: string, since: Date): Promise<number> {
  const { count, error } = await getDb()
    .from("start_attempts")
    .select("id", { count: "exact", head: true })
    .eq("bucket", key)
    .gte("at", since.toISOString());
  if (error) throw new Error(`start_attempts read failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Count this attempt, or refuse it (429) when the hour's limit is reached.
 * A refused attempt is not counted, so waiting is enough to get back in.
 */
export async function rateLimit(step: StartStep, ip: string, email?: string): Promise<void> {
  const limits = START_LIMITS[step] as { ip: number; email?: number };
  const since = new Date(Date.now() - WINDOW_MS);
  const ipKey = bucket(step, "ip", ip);
  if ((await countSince(ipKey, since)) >= limits.ip) throw new StartError(TOO_MANY, 429);
  const keys = [ipKey];
  if (email && limits.email !== undefined) {
    const emailKey = bucket(step, "email", email);
    if ((await countSince(emailKey, since)) >= limits.email) throw new StartError(TOO_MANY_FOR_ADDRESS, 429);
    keys.push(emailKey);
  }
  const db = getDb();
  const { error } = await db.from("start_attempts").insert(keys.map((k) => ({ bucket: k })));
  if (error) throw new Error(`start_attempts write failed: ${error.message}`);
  // Keep the table small: anything older than a day says nothing any more.
  await db.from("start_attempts").delete().lt("at", new Date(Date.now() - PRUNE_AFTER_MS).toISOString());
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
  const token = randomBytes(32).toString("base64url");
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
 * cap, single use.
 */
export async function verifyStartCode(session: StartSession, email: string, rawCode: unknown): Promise<void> {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new StartError("Enter the six-digit code.");
  const row = await readCode(email);
  if (!row) throw new StartError("No code is waiting for that address. Ask for a new one.", 401);
  if (row.locked_until && Date.now() < Date.parse(row.locked_until)) {
    throw new StartError(lockoutMessage(row.locked_until), 429);
  }
  const db = getDb();
  const spend = () => db.from("start_codes").delete().eq("email", email);
  if (Date.now() > Date.parse(row.expires_at)) {
    await spend();
    throw new StartError("That code has expired. Ask for a new one.", 401);
  }
  if (!sameHash(row.code_hash, sha256(code))) {
    const attempts = row.attempts + 1;
    const locked = attempts >= MAX_VERIFY_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
    await db.from("start_codes").update({ attempts, locked_until: locked }).eq("email", email);
    throw new StartError(locked ? lockoutMessage(locked) : "That code is not right. Check the email and try again.", locked ? 429 : 401);
  }
  await spend(); // a code works once
  await setSessionEmail(session, email);
}
