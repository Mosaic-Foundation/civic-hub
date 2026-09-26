// @civic-raw-client-importer: the super admin's codes and sessions are platform data, not any hub's.
// The super admin's sign-in: an emailed code to the one allowed address, a
// session, and step-up — a second, fresh code — before anything destructive.
//
// The code's rules (lifetime, throttle, wrong-guess cap, lockout, the email
// itself) are a hub's, from src/modules/civic.auth/otp.ts. What differs is
// where things are kept: `control_codes` and `control_sessions`, platform
// tables with deny-all RLS, and codes and session tokens are stored only as
// SHA-256 hashes.
//
// Only CIVIC_CONSOLE_ADMIN_EMAIL is ever sent a code. Anyone else who asks
// gets the same answer and nothing is sent or stored, so the form does not
// say who the operator is.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
import { consoleAdminEmail } from "./config.js";

export type CodePurpose = "sign_in" | "step_up";

/** A console session lasts a working day, not a month. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const CODE_SENT = "If that address may sign in here, a code is on its way.";

export class ControlAuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ControlAuthError";
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

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Is this the one address allowed in? False when none is configured. */
export function isConsoleAdmin(email: string): boolean {
  const config = consoleAdminEmail();
  return config.ok && config.email === normalizeEmail(email);
}

interface CodeRow {
  code_hash: string;
  expires_at: string;
  created_at: string;
  attempts: number;
  locked_until: string | null;
}

async function readCode(email: string, purpose: CodePurpose): Promise<CodeRow | null> {
  const { data, error } = await getDb()
    .from("control_codes")
    .select("code_hash, expires_at, created_at, attempts, locked_until")
    .eq("email", email)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) throw new Error(`control_codes read failed: ${error.message}`);
  return (data as CodeRow | null) ?? null;
}

/**
 * Email a code for `purpose`. For anyone but the allowed address, does
 * nothing and says the same thing.
 */
export async function requestCode(rawEmail: unknown, purpose: CodePurpose): Promise<string> {
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) throw new ControlAuthError("Enter an email address.");

  const config = consoleAdminEmail();
  if (!config.ok) {
    console.warn(`[control] sign-in refused: ${config.problem}`);
    throw new ControlAuthError("The console has no operator configured.", 503);
  }
  if (email !== config.email) {
    console.warn(`[control] code requested for a non-operator address (${purpose})`);
    return CODE_SENT;
  }

  const recent = await readCode(email, purpose);
  if (recent?.locked_until && Date.now() < Date.parse(recent.locked_until)) {
    throw new ControlAuthError(lockoutMessage(recent.locked_until), 429);
  }
  if (recent && Date.now() - Date.parse(recent.created_at) < REQUEST_THROTTLE_MS) {
    throw new ControlAuthError("Please wait a moment before requesting another code.", 429);
  }

  const code = generateOTP();
  const now = Date.now();
  const { error } = await getDb().from("control_codes").upsert(
    {
      email,
      purpose,
      code_hash: sha256(code),
      expires_at: new Date(now + OTP_TTL_MS).toISOString(),
      created_at: new Date(now).toISOString(),
      attempts: 0,
      locked_until: null,
    },
    { onConflict: "email,purpose" },
  );
  if (error) throw new Error(`control_codes write failed: ${error.message}`);

  const action = purpose === "sign_in" ? "finish signing in" : "confirm this change";
  const result = await sendEmail({
    to: email,
    subject: purpose === "sign_in" ? "Your Civic Social console code" : "Confirm a Civic Social console change",
    html: renderCodeEmail(code, "Civic Social console", action),
  });
  if (!result.sent) {
    console.warn(`[control] code email NOT sent (${result.error}).`);
    // As a hub's sign-in: the code reaches the log only when there is no
    // mailer at all, which is local development.
    if (!process.env.RESEND_API_KEY) {
      console.log(`\n[control] ${purpose} code for ${email}: ${code}\n`);
    }
  }
  return CODE_SENT;
}

/**
 * Check a code and spend it. Same rules as a hub's consumePendingCode:
 * lockout, expiry, the wrong-guess cap, single use.
 */
export async function consumeCode(rawEmail: unknown, purpose: CodePurpose, rawCode: unknown): Promise<string> {
  const email = normalizeEmail(rawEmail);
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(code)) throw new ControlAuthError("Enter the six-digit code.");
  if (!isConsoleAdmin(email)) throw new ControlAuthError("Invalid code.", 401);

  const row = await readCode(email, purpose);
  if (!row) throw new ControlAuthError("No code is waiting. Request a new one.", 401);
  if (row.locked_until && Date.now() < Date.parse(row.locked_until)) {
    throw new ControlAuthError(lockoutMessage(row.locked_until), 429);
  }
  const db = getDb();
  const spend = () => db.from("control_codes").delete().eq("email", email).eq("purpose", purpose);
  if (Date.now() > Date.parse(row.expires_at)) {
    await spend();
    throw new ControlAuthError("That code has expired. Request a new one.", 401);
  }
  if (!sameHash(row.code_hash, sha256(code))) {
    const attempts = row.attempts + 1;
    const locked = attempts >= MAX_VERIFY_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
    await db
      .from("control_codes")
      .update({ attempts, locked_until: locked })
      .eq("email", email)
      .eq("purpose", purpose);
    throw new ControlAuthError(locked ? lockoutMessage(locked) : "Invalid code.", locked ? 429 : 401);
  }
  await spend(); // a code works once
  return email;
}

export interface ControlSession {
  email: string;
  expires_at: string;
}

/** Start a session; returns the token, which is never stored. */
export async function createSession(email: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await getDb()
    .from("control_sessions")
    .insert({ token_hash: sha256(token), email, expires_at: expiresAt });
  if (error) throw new Error(`control_sessions write failed: ${error.message}`);
  return { token, expiresAt };
}

/**
 * The session a token belongs to, or null. Also null when the address is no
 * longer the configured operator: changing CIVIC_CONSOLE_ADMIN_EMAIL ends
 * every session the previous operator held.
 */
export async function sessionFromToken(token: string | undefined): Promise<ControlSession | null> {
  if (!token) return null;
  const { data, error } = await getDb()
    .from("control_sessions")
    .select("email, expires_at, revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { email: string; expires_at: string; revoked_at: string | null };
  if (row.revoked_at || Date.now() > Date.parse(row.expires_at)) return null;
  if (!isConsoleAdmin(row.email)) return null;
  return { email: row.email, expires_at: row.expires_at };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb()
    .from("control_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", sha256(token));
}
