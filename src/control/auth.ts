// @civic-raw-client-importer: the super admin's codes and sessions are platform data, not any hub's.
// The super admin's sign-in: an emailed code to the one allowed address, a
// session, and step-up — a second, fresh code — before anything destructive.
//
// The code's rules (lifetime, live codes, tries, the email itself) are a
// hub's, from src/modules/civic.auth/codeRules.ts and otp.ts. What differs is
// where things are kept: `platform_sign_in_codes` and `control_sessions`,
// platform tables with deny-all RLS, and codes and session tokens are stored
// only as SHA-256 hashes.
//
// Only CIVIC_CONSOLE_ADMIN_EMAIL is ever sent a code. Anyone else who asks
// gets the same answer and nothing is sent or stored, so the form does not
// say who the operator is.

import { env } from "../config/env.js";
import { CivicError, RateLimitedError, codeForStatus } from "../errors/index.js";
import { getDb } from "../db/client.js";
import { HOUR_MS, retryAt, takeRateLimit } from "../db/rateLimit.js";
import { randomToken, sha256Hex } from "../utils/hash.js";
import { sendEmail, mailConfigured } from "../utils/email.js";
import { renderCodeEmail } from "../modules/civic.auth/otp.js";
import { WRONG_CODE, checkCode, issueCode, tooManyMessage } from "../modules/civic.auth/codeRules.js";
import { platformCodeStore, platformRealm } from "./platformCodes.js";
import { consoleAdminEmail } from "./config.js";

export type { CodePurpose } from "./platformCodes.js";
import type { CodePurpose } from "./platformCodes.js";

/** A console session lasts a working day, not a month. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const CODE_SENT = "If that address may sign in here, a code is on its way.";

export class ControlAuthError extends CivicError {
  constructor(message: string, status = 400) {
    super(status, codeForStatus(status), message);
  }
}

const sha256 = sha256Hex;

/**
 * Per IP per hour (Audit 2, Adam 2026-10-11), sign-in and step-up together:
 * one person needs a handful. Counted before anything else, including for an
 * address that is not the operator's, so the form cannot be used to mail-bomb
 * the operator or to guess at the code.
 */
export const CONSOLE_LIMITS = { request_code: { ip: 5 }, verify: { ip: 10 } } as const;
function consoleRealm(timeZone: unknown) {
  return platformRealm("console", { request: CONSOLE_LIMITS.request_code.ip, verify: CONSOLE_LIMITS.verify.ip }, timeZone);
}

/** Count one step against the IP, or refuse with the time it can try again. */
async function limit(step: keyof typeof CONSOLE_LIMITS, ip: string, timeZone: string): Promise<void> {
  const check = { scope: `console.${step}`, by: "ip", value: ip, limit: CONSOLE_LIMITS[step].ip, windowMs: HOUR_MS };
  if (!(await takeRateLimit([check]))) return;
  const at = (await retryAt(check)) ?? new Date(Date.now() + HOUR_MS);
  throw new RateLimitedError(tooManyMessage(at, timeZone), "rate_limited", { extra: { retry_at: at.toISOString() } });
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Is this the one address allowed in? False when none is configured. */
export function isConsoleAdmin(email: string): boolean {
  const config = consoleAdminEmail();
  return config.ok && config.email === normalizeEmail(email);
}

/**
 * Email a code for `purpose`. For anyone but the allowed address, does
 * nothing and says the same thing. The code's rules are a hub's
 * (codeRules.ts): up to three live codes, one email a minute, ten an hour,
 * and wrong tries burn the code rather than lock the address, which matters
 * most here: the console has exactly one address to lock.
 */
export async function requestCode(rawEmail: unknown, purpose: CodePurpose, ip: string, timeZone?: unknown): Promise<string> {
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) throw new ControlAuthError("Enter an email address.");
  const realm = consoleRealm(timeZone);
  // Counted first, for any address, so the form can't be used to mail-bomb
  // the operator or to learn who it is.
  await limit("request_code", ip, realm.timeZone);

  const config = consoleAdminEmail();
  if (!config.ok) {
    console.warn(`[control] sign-in refused: ${config.problem}`);
    throw new ControlAuthError("The console has no operator configured.", 503);
  }
  if (email !== config.email) {
    console.warn(`[control] code requested for a non-operator address (${purpose})`);
    return CODE_SENT;
  }

  // The IP was counted above, so issueCode doesn't count it again.
  const { code } = await issueCode(platformCodeStore("console", purpose), { ...realm, ipLimits: { ...realm.ipLimits, request: null } }, ip, email);

  const action = purpose === "sign_in" ? "finish signing in" : "confirm this change";
  const rendered = renderCodeEmail(code, "Civic Social console", action);
  const result = await sendEmail({
    to: email,
    subject: purpose === "sign_in" ? "Your Civic Social console code" : "Confirm a Civic Social console change",
    html: rendered.html,
    text: rendered.text,
  });
  if (!result.sent) {
    console.warn(`[control] code email NOT sent (${result.error}).`);
    // As a hub's sign-in: the code reaches the log only when there is no
    // mailer at all, which is local development.
    if (!mailConfigured()) {
      console.log(`\n[control] ${purpose} code for ${email}: ${code}\n`);
    }
  }
  return CODE_SENT;
}

/** Check a code and spend it, by the shared rules (codeRules.ts). */
export async function consumeCode(rawEmail: unknown, purpose: CodePurpose, rawCode: unknown, ip: string, timeZone?: unknown): Promise<string> {
  const email = normalizeEmail(rawEmail);
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const realm = consoleRealm(timeZone);
  if (!/^\d{6}$/.test(code)) {
    await limit("verify", ip, realm.timeZone);
    throw new ControlAuthError("Enter the six-digit code.");
  }
  if (!isConsoleAdmin(email)) {
    await limit("verify", ip, realm.timeZone);
    throw new ControlAuthError(WRONG_CODE, 401);
  }
  await checkCode(platformCodeStore("console", purpose), realm, ip, { email, code });
  return email;
}

export interface ControlSession {
  email: string;
  expires_at: string;
}

/** Start a session; returns the token, which is never stored. */
export async function createSession(email: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
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
