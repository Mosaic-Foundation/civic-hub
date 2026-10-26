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
import { HOUR_MS, releaseRateLimit, retryAt, takeRateLimit } from "../db/rateLimit.js";
import { randomToken, sha256Hex } from "../utils/hash.js";
import { sendEmail, mailConfigured } from "../utils/email.js";
import { renderCodeEmail } from "../modules/civic.auth/otp.js";
import { WRONG_CODE, checkCode, issueCode, tooManyMessage } from "../modules/civic.auth/codeRules.js";
import { platformCodeStore, platformRealm, withdrawPlatformCode } from "./platformCodes.js";
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

  const config = consoleAdminEmail();
  if (!config.ok) {
    console.warn(`[control] sign-in refused: ${config.problem}`);
    throw new ControlAuthError("The console has no operator configured.", 503);
  }
  if (email !== config.email) {
    // Counted, so the form can't be used to learn who the operator is by
    // which requests count; and nothing is sent.
    await limit("request_code", ip, realm.timeZone);
    console.warn(`[control] code requested for a non-operator address (${purpose})`);
    return CODE_SENT;
  }

  // The operator's request is counted against the IP together with the
  // code's own limits, in one take: a request that is refused (a code of this
  // kind still waiting from under a minute ago, three waiting, ten this hour)
  // sends nothing and counts nothing (plugin session 2: refused requests had
  // used up the operator's five an hour).
  const issued = await issueCode(platformCodeStore("console", purpose), realm, ip, email);

  const action = purpose === "sign_in" ? "finish signing in" : "confirm this change";
  const rendered = renderCodeEmail(issued.code, "Civic Social console", action);
  const result = await sendEmail({
    to: email,
    subject: purpose === "sign_in" ? "Your Civic Social console code" : "Confirm a Civic Social console change",
    html: rendered.html,
    text: rendered.text,
  });
  if (!result.sent) {
    console.warn(`[control] code email NOT sent (${result.error}).`);
    if (mailConfigured()) {
      // The mailer is there and failed: the code never reached anyone, so it
      // is withdrawn and the request counts for nothing. Said, so the
      // operator does not wait for an email that is not coming.
      await withdrawPlatformCode("console", purpose, email, sha256Hex(issued.code));
      await releaseRateLimit(issued.counted);
      throw new ControlAuthError("The code email could not be sent just now, and nothing was counted. Try again in a moment.", 502);
    }
    // As a hub's sign-in: with no mailer at all (local development) the code
    // reaches the log.
    console.log(`\n[control] ${purpose} code for ${email}: ${issued.code}\n`);
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
  /** Until when its catalog actions need no fresh code (one code confirms them for ten minutes), or null. */
  catalog_confirmed_until: string | null;
}

/** How long one fresh code confirms the catalog's actions on a session (ADR-015). */
export const CATALOG_WINDOW_MS = 10 * 60 * 1000;

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
    .select("email, expires_at, revoked_at, catalog_confirmed_until")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { email: string; expires_at: string; revoked_at: string | null; catalog_confirmed_until: string | null };
  if (row.revoked_at || Date.now() > Date.parse(row.expires_at)) return null;
  if (!isConsoleAdmin(row.email)) return null;
  return { email: row.email, expires_at: row.expires_at, catalog_confirmed_until: row.catalog_confirmed_until ?? null };
}

/** A fresh code was entered for a catalog action: the session's catalog actions need none for ten minutes. */
export async function confirmCatalogWindow(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const until = new Date(Date.now() + CATALOG_WINDOW_MS).toISOString();
  const { error } = await getDb().from("control_sessions").update({ catalog_confirmed_until: until }).eq("token_hash", sha256(token));
  if (error) throw new Error(`control_sessions write failed: ${error.message}`);
  return until;
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb()
    .from("control_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", sha256(token));
}
