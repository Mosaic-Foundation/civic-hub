// civic.auth module — email-based authentication service
//
// Minimal auth for civic participation:
//   1. User enters email → OTP code generated
//   2. User verifies with code → account created/logged in
//   3. User affirms residency → is_resident = true
//
// Storage: Postgres via Supabase (tables: users, sessions, pending_verifications)
// Identity: DID-compatible — user.id is a text field, replaceable with a DID later.
//
// Per hub since Phase 2a: accounts, sessions and sign-in codes all carry
// hub_id, and every query here goes through forHub(). A person has one
// account per hub (ADR-004). An email is found, a code checked and a session
// resolved only on the hub the request is for, so a session minted on one hub
// is not a session on another, and neither is its user.
//
// Since the post-cutover cleanup (20260926005000) the keys are per hub, so one
// address can hold an account and a pending code on each hub. Before it, the
// global `users_email_key` and `pending_verifications_pkey (email)` refused a
// second hub's copy; the 23505 branches below that answered for them stay as
// guards for a database that has not had the cleanup, and do not name the hub.
//
// GUARDRAIL: This module MUST NOT import from civic.vote or civic.proposals.

import { forHub, HubDbError, type HubDb, type Row } from "../../db/forHub.js";
import { generateId } from "../../utils/id.js";
import { randomToken, sameHexHash, sha256Hex } from "../../utils/hash.js";
import {
  OTP_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  REQUEST_THROTTLE_MS,
  LOCKOUT_MS,
  generateOTP,
  lockoutMessage,
  renderCodeEmail,
} from "./otp.js";
import { sendEmail } from "../../utils/email.js";
import { limitCodeCheck, limitCodeRequest } from "./limits.js";
import {
  getAdminEmailsSync,
  isBetaEnabledSync,
  isDemoHubSync,
  isEmailOnBetaAllowlist,
  hubDisplayNameSync,
} from "../../services/hubSettings.js";
import { isPrivilegedEmail, isPrivilegedEmailNow } from "../../services/privilegedAccounts.js";
import { lookupOfficialByEmail } from "../../services/officials.js";
import { currentHubId, currentHubIdOrNull } from "../../config/hubContext.js";
import type { User, PendingVerification, Session, SessionAssurance } from "./models.js";
import { readAll } from "../../db/readAll.js";

export type { User, PendingVerification, Session, SessionAssurance } from "./models.js";

// --- Constants ---

// A "keep me signed in" option, when it comes, is a longer expires_at on the
// same row; nothing else about a session changes.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// The code's rules (TTL, attempts, throttle, lockout) live in ./otp.ts,
// shared with the super admin's sign-in.

/** The hub in scope. Everything here runs inside a request for one hub. */
function db(): HubDb {
  return forHub(currentHubId());
}

/**
 * Shown when an address collides with a global unique email on another hub
 * (only on a database without the post-cutover cleanup). Deliberately does not name the hub, or say that there is one.
 */
const ADDRESS_IN_USE_ELSEWHERE =
  "This address can't be used to sign in to this hub yet. Please use a different address.";

// --- Session tokens ---
//
// 256 random bits. The browser holds the token; the database holds only its
// SHA-256 (sessions.token, constraint sessions_token_is_hash), and every
// lookup hashes what was presented, as the console's sessions always have
// (Audit 2, 2026-10-11). Before that a token was 60 random bits stored as is.

function generateToken(): string {
  return randomToken();
}

/** Start a session for this account on the hub in scope; returns the token. */
async function insertSession(
  hubDb: HubDb,
  userId: string,
  assurance: SessionAssurance,
  ttlMs = SESSION_TTL_MS,
  token = generateToken(),
): Promise<string> {
  // Stamped with the hub it was minted on, by forHub. A session is a bearer
  // credential, so without this a token from one hub would authenticate its
  // holder on every other hub this deployment serves.
  await hubDb.from("sessions").insert({
    token: sha256Hex(token),
    user_id: userId,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    assurance,
  });
  return token;
}

// --- Row mappers ---

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    email_verified: Boolean(row.email_verified),
    is_resident: Boolean(row.is_resident),
    created_at: String(row.created_at),
    // digest_frequency_days: null = unsubscribed, 1 = daily, etc.
    // Default to 1 (daily) for rows that pre-date the migration.
    digest_frequency_days:
      row.digest_frequency_days === undefined || row.digest_frequency_days === null
        ? null
        : Number(row.digest_frequency_days),
    last_digest_sent_at: row.last_digest_sent_at
      ? String(row.last_digest_sent_at)
      : null,
    tos_version_accepted: row.tos_version_accepted
      ? String(row.tos_version_accepted)
      : null,
    tos_accepted_at: row.tos_accepted_at
      ? String(row.tos_accepted_at)
      : null,
    // Defaults false for rows (or databases) that pre-date the migration.
    hide_ai_drafting_help: Boolean(row.hide_ai_drafting_help),
    display_name: row.display_name ? String(row.display_name) : null,
    full_name: row.full_name ? String(row.full_name) : null,
  };
}

/** Shared validation for real names — used by sign-up and profile update. */
export function normalizeFullName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (value.length < 2) {
    throw new Error("Please enter your full name");
  }
  if (value.length > 100) {
    throw new Error("Name must be 100 characters or fewer");
  }
  return value;
}

// --- Auth flow ---

/**
 * Step 1: Request a verification code for an email.
 * If user exists, they'll be logged in on verify.
 * If not, a new account will be created on verify.
 *
 * DEV: Code is logged to console. In production, send via email.
 */
export async function requestVerification(
  email: string,
  // The caller's IP (src/utils/clientIp.ts), for the per-IP limit. Required,
  // so no caller can skip the limits by forgetting them.
  ip: string,
  // "step_up" is a fresh code to confirm a change (adminStepUp.ts), not a sign-in.
  purpose: "sign_in" | "step_up" = "sign_in",
): Promise<{ message: string; no_email?: true }> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Invalid email address");
  }

  // Counted first, before anything is looked up or sent: a request refused
  // here costs nothing, and a demo hub's requests count too (Audit 2).
  await limitCodeRequest(ip, currentHubId(), normalizedEmail);

  // A demo hub does not email sign-in codes. Any visitor can look around, so
  // the OTP generation, the pending_verifications insert and the Resend send
  // are all skipped: a demo signup should not mail a throwaway address, burn
  // Resend quota, or confuse someone who was not expecting an email.
  //
  // WHAT CHANGED, AND WHY IT MATTERS (Phase 1 part two).
  //
  // This used to key off `NODE_ENV !== "production"`, which was the right
  // guard when a demo was its own deployment: production could not be
  // bypassed even if the env var leaked onto it. One deployment now serves
  // every hub, so NODE_ENV is "production" for the demo hub too — that guard
  // would have switched the demo OFF rather than protected Floyd. The test is
  // now per hub, and the protection is that `beta.demo_mode` is an admin-only
  // settings row that Floyd's hub simply does not have.
  //
  // There is also no longer a code to leak. A demo hub accepts any six
  // digits, so nothing is displayed to the visitor, nothing is compiled into
  // the bundle and nothing is served by the config endpoint. A shared static
  // code printed on the sign-in screen was never a secret; this removes the
  // pretence and the thing that could be exfiltrated at the same time.
  // A demo hub does not email sign-in codes to ordinary visitors — that is
  // what makes it a demo — but a PRIVILEGED account gets the real flow even
  // here. An admin or an official can moderate, publish, and change what the
  // hub is; "any six digits" for those accounts would mean anyone who knows
  // an admin's email address can be that admin. The relaxation is for people
  // looking around, never for the people running the place.
  if (isDemoHubSync() && !(await isPrivilegedEmailNow(normalizedEmail))) {
    console.log(
      `[auth] Demo hub signin for ${normalizedEmail} — no code emailed.`,
    );
    // `no_email` tells the sign-in screen not to say "Check your email"
    // (review R22): nothing was sent. An admin on the same demo hub gets the
    // ordinary answer and a real code.
    return {
      message: "No email is sent on a demo hub. Enter any six digits to sign in.",
      no_email: true,
    };
  }

  // A beta hub admits its admin roster, its allow list, and its officials
  // (Adam, 2026-10-07): anyone an admin entered in the officials list is
  // treated as if on the allow list for signing in. Only for signing in: the
  // mail guard still holds notifications to officials on a demo or beta hub
  // (mailGuard.ts), and their sign-in code passes it as every code does.
  if (isBetaEnabledSync()) {
    const adminEmails = getAdminEmailsSync();
    if (!adminEmails.includes(normalizedEmail)) {
      const allowed =
        (await isEmailOnBetaAllowlist(currentHubId(), normalizedEmail)) ||
        (await lookupOfficialByEmail(normalizedEmail)) !== null;
      if (!allowed) {
        throw new Error("This hub is currently in private beta.");
      }
    }
  }

  // A failed read throws rather than skipping the checks below: before
  // Phase 2a an error here was ignored, which failed OPEN on the lockout.
  const recent = await db()
    .from("pending_verifications")
    .select<{ created_at: string | null; locked_until: string | null }>(
      "created_at, locked_until",
    )
    .eq("email", normalizedEmail)
    .maybeSingle();
  // Lockout: if this email is in its post-brute-force cooldown, refuse to issue
  // a new code (otherwise the lockout is trivially escaped by re-requesting).
  if (recent?.locked_until && Date.now() < new Date(recent.locked_until).getTime()) {
    throw new Error(lockoutMessage(recent.locked_until));
  }
  // Throttle: reject a fresh code if one was requested for this email very
  // recently. Without this an attacker could reset the wrong-guess cap by
  // simply re-requesting a new code each time.
  if (
    recent?.created_at &&
    Date.now() - new Date(recent.created_at).getTime() < REQUEST_THROTTLE_MS
  ) {
    throw new Error("Please wait a moment before requesting another code.");
  }

  const code = generateOTP();
  const now = new Date();
  const expires = new Date(now.getTime() + OTP_TTL_MS);

  try {
    await db()
    .from("pending_verifications")
    .upsert(
      {
        email: normalizedEmail,
        // Only the hash is kept (constraint pending_verifications_no_plain_code).
        // A later "Sign in" link in the email adds its own hash beside this
        // one and is checked through the same attempt counter.
        code_hash: sha256Hex(code),
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
        attempts: 0, // fresh code, reset the wrong-guess counter
        locked_until: null, // and clear any expired lockout
      },
      { onConflict: "hub_id,email" },
    );
  } catch (err) {
    // 23505 on (hub_id, email) cannot happen — that is the conflict target —
    // so it is a global primary key (email), which only a database without
    // the post-cutover cleanup has: a pending code on another hub.
    if (err instanceof HubDbError && err.code === "23505") {
      console.warn(`[auth] ${normalizedEmail} has a pending code on another hub (global key)`);
      throw new Error(ADDRESS_IN_USE_ELSEWHERE);
    }
    throw new Error(`Auth: failed to store verification: ${(err as Error).message}`);
  }

  // Send the OTP via email. If Resend is not configured (dev), fall back
  // to logging so local development still works.
  const hubDisplayName = hubDisplayNameSync();
  const result = await sendEmail({
    to: normalizedEmail,
    subject:
      purpose === "step_up"
        ? `${hubDisplayName}: your code to confirm a change`
        : `Your ${hubDisplayName} sign-in code`,
    html: renderOtpEmail(code, hubDisplayName, purpose),
    // Through the mode guard on every mode: it goes only to the address that
    // asked (mailGuard.ts). This is what lets an official sign in on a demo.
    purpose: "sign_in_code",
  });

  if (result.sent) {
    console.log(`[auth] Sent verification code to ${normalizedEmail} (resend id: ${result.id})`);
  } else {
    // The failure is always logged prominently: a misconfiguration here is
    // silent to the user, who is told "code sent" either way because we do
    // not leak whether an address is deliverable.
    console.warn(
      `[auth] Email NOT sent for ${normalizedEmail} (${result.error}).`,
    );

    // THE CODE ITSELF IS LOGGED ONLY WHEN NO MAILER IS CONFIGURED.
    //
    // This used to log on ANY send failure, and the comment beside it said
    // "(dev only)" while the code checked nothing — so a deployment with a
    // working key that hit a provider outage, a rate limit or an unverified
    // domain wrote live one-time codes into its function log in plaintext.
    // Found 2026-09-23, when exactly that happened on the dev deployment:
    // Resend refused an unverified domain and every requested code appeared
    // in the log stream. Anyone who can read logs could then sign in as
    // anyone who had tried to.
    //
    // Keyless is a different case and is genuinely local development: there
    // is no mailer at all, the console IS the mailbox, and no real user is
    // waiting on an email that will not arrive.
    if (!process.env.RESEND_API_KEY) {
      console.log(`\n[auth] Verification code for ${normalizedEmail}: ${code}\n`);
    } else {
      console.warn(
        `[auth] The code was NOT logged: a mailer is configured, so this is a ` +
        `delivery failure rather than local development. Fix the mailer.`,
      );
    }
  }

  return { message: "Verification code sent" };
}

function renderOtpEmail(code: string, rawHubName: string, purpose: "sign_in" | "step_up"): string {
  return purpose === "step_up"
    ? renderCodeEmail(code, rawHubName, "confirm your change", "Your code to confirm a change")
    : renderCodeEmail(code, rawHubName);
}

/**
 * Check a one-time code and spend it.
 *
 * Extracted from verifyCode so that anything else needing proof of the
 * mailbox — changing a hub's mode, for one — enforces the SAME rules rather
 * than growing its own weaker copy. Lockout, expiry, the wrong-guess counter
 * and single use all live here, once.
 *
 * Throws on every failure, with the message the caller shows. On success the
 * pending row is deleted, which is what makes a code single-use: a second
 * attempt finds no row and is refused.
 *
 * ATOMIC (Audit 2, 2026-10-11). take_code_attempt spends one attempt in one
 * conditional UPDATE and returns the code's hash only while attempts are under
 * the limit and no lock is running; the attempt that reaches the limit sets
 * the lock in the same statement. The code is compared only when a row comes
 * back. Before this the count was read, compared and written back from here,
 * so N concurrent guesses advanced it by about one.
 */
export async function consumePendingCode(
  email: string,
  code: string,
  // The caller's IP, for the per-IP limit on codes typed in.
  ip: string,
): Promise<void> {
  const hubDb = db();
  const normalizedEmail = email.trim().toLowerCase();

  await limitCodeCheck(ip);

  const taken = await hubDb.rpc<Array<{ code_hash: string; expires_at: string; attempts: number }>>(
    "take_code_attempt",
    {
      p_email: normalizedEmail,
      p_max: MAX_VERIFY_ATTEMPTS,
      p_lock_seconds: Math.round(LOCKOUT_MS / 1000),
    },
  );
  const row = Array.isArray(taken) ? taken[0] : undefined;

  if (!row) {
    // No attempt was left to spend. Say why.
    const current = await hubDb
      .from("pending_verifications")
      .select<{ locked_until: string | null }>("locked_until")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (!current) {
      throw new Error("No pending verification for this email. Request a new code.");
    }
    if (current.locked_until && Date.now() < Date.parse(current.locked_until)) {
      throw new Error(lockoutMessage(current.locked_until));
    }
    // The lock has passed, but this code used up its tries; it is dead.
    throw new Error("That code can no longer be used. Request a new code.");
  }
  if (Date.now() > Date.parse(row.expires_at)) {
    await hubDb
      .from("pending_verifications")
      .delete()
      .eq("email", normalizedEmail)
      .eq("code_hash", row.code_hash);
    throw new Error("Verification code expired. Request a new code.");
  }
  if (!sameHexHash(row.code_hash, sha256Hex(String(code).trim()))) {
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      // This attempt reached the limit; the database locked the address.
      throw new Error(lockoutMessage(new Date(Date.now() + LOCKOUT_MS).toISOString()));
    }
    throw new Error("Invalid verification code");
  }
  // Spend it: the delete is the spend, so of two requests with the right
  // code, one gets the row. Only this code's row, so a newer code requested
  // in the meantime is left alone.
  const spent = await hubDb
    .from("pending_verifications")
    .delete()
    .eq("email", normalizedEmail)
    .eq("code_hash", row.code_hash)
    .select<{ email: string }>("email");
  if (spent.length === 0) {
    throw new Error("That code has already been used. Request a new code.");
  }
}

/**
 * Step 2: Verify the code and create/login user.
 * Returns a session token and user object.
 */
export async function verifyCode(
  email: string,
  code: string,
  // The caller's IP, for the per-IP limit on codes typed in.
  ip: string,
): Promise<{ token: string; user: User }> {
  const normalizedEmail = email.trim().toLowerCase();
  const hubDb = db();

  // A demo hub accepts any six digits from an ordinary visitor (see
  // requestVerification). Gated on the hub's own `mode`, which lives only in
  // the database, so nothing in a deployment's configuration can turn this on
  // for a hub that is not a demo.
  //
  // Privileged accounts are excluded and fall through to the real code path,
  // because an admin who can be impersonated by typing six digits is not an
  // admin. The shape check keeps the form's validation honest and stops an
  // empty submission walking in.
  //
  // Such a session is a DEMO session (Audit 2): it proves nothing about the
  // mailbox, so it never passes an admin, official or poster check, it reads
  // as signed out once the hub leaves demo, and it ends if its address is
  // later made privileged (the triggers in 20261011100000).
  let assurance: SessionAssurance;
  if (
    isDemoHubSync() &&
    /^\d{6}$/.test(code.trim()) &&
    !(await isPrivilegedEmailNow(normalizedEmail))
  ) {
    await limitCodeCheck(ip);
    await hubDb
      .from("pending_verifications")
      .delete()
      .eq("email", normalizedEmail);
    assurance = "demo";
  } else {
    await consumePendingCode(normalizedEmail, code, ip);
    assurance = "code";
  }

  const user = await findOrCreateVerifiedUser(normalizedEmail);
  const token = await insertSession(hubDb, user.id, assurance);
  return { token, user };
}

/**
 * The account for a verified address on the hub in scope: found (and marked
 * verified), or created. Race-safe: unique (hub_id, email) rejects a second
 * insert, and the loser reads the winner's row. Used by sign-in and by the
 * start page's handoff (createHandoffSession).
 */
async function findOrCreateVerifiedUser(normalizedEmail: string): Promise<User> {
  const hubDb = db();
  const existing = await hubDb
    .from("users")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  let user: User;

  if (existing) {
    // Mark email_verified if it wasn't already
    if (!existing.email_verified) {
      const updated = await hubDb
        .from("users")
        .update({ email_verified: true })
        .eq("id", existing.id)
        .select()
        .single();
      user = rowToUser(updated);
    } else {
      user = rowToUser(existing);
    }
  } else {
    // Create new user. Race-safe: unique (hub_id, email) rejects duplicates.
    // digest_frequency_days defaults to 1 (daily, opt-out model). Setting
    // it explicitly here documents the intent and protects against a
    // future default change in the migration.
    const newRow = {
      id: generateId("user"),
      email: normalizedEmail,
      email_verified: true,
      is_resident: false,
      digest_frequency_days: 1,
    };

    let inserted: Row | null = null;
    try {
      inserted = await hubDb.from("users").insert(newRow).select().single();
    } catch (err) {
      // 23505 = unique_violation — another request created the user first.
      if (!(err instanceof HubDbError && err.code === "23505")) throw err;
    }

    if (inserted) {
      user = rowToUser(inserted);
      console.log(`[auth] New user created: ${user.id} (${normalizedEmail})`);
    } else {
      const refetch = await hubDb
        .from("users")
        .select("*")
        .eq("email", normalizedEmail)
        .maybeSingle();
      if (!refetch) {
        // Not on this hub: the violation was a global users_email_key (only
        // on a database without the post-cutover cleanup), so the address
        // has an account on another hub.
        console.warn(`[auth] ${normalizedEmail} has an account on another hub (global key)`);
        throw new Error(ADDRESS_IN_USE_ELSEWHERE);
      }
      user = rowToUser(refetch);
    }
  }

  return user;
}

// --- The start page's handoff (session 4b, 2026-10-08) ---
//
// A person who creates a hub on the start page lands on it signed in. Hub
// sessions are bearer tokens each hub's page keeps for its own origin, so
// nothing set on the start page reaches the hub: the start page (as the
// service role, inside the new hub's scope) mints a HANDOFF session here, a
// token that lives two minutes, and sends the browser to
// https://<hub>/#handoff=<token>. The fragment never reaches a server or a
// Referer. The hub's page swaps it for an ordinary session at once
// (POST /auth/handoff → exchangeHandoff) and strips it from the address bar.
//
// A handoff token is not a session: getUserFromToken refuses it, so it can
// only be exchanged, once.

const HANDOFF_PREFIX = "handoff";
const HANDOFF_TTL_MS = 2 * 60 * 1000;

function isHandoffToken(token: string): boolean {
  return token.startsWith(`${HANDOFF_PREFIX}_`);
}

/**
 * Mint a handoff for this address on the hub in scope, creating its account.
 * Returns the token. The start page proved the address with its own emailed
 * code, so the handoff, and the session it becomes, are 'code' sessions.
 */
export async function createHandoffSession(email: string): Promise<string> {
  const user = await findOrCreateVerifiedUser(email.trim().toLowerCase());
  return insertSession(db(), user.id, "code", HANDOFF_TTL_MS, `${HANDOFF_PREFIX}_${randomToken()}`);
}

/**
 * Spend a handoff token for an ordinary session on the hub in scope. The
 * delete is the spend: of two requests with one token, one gets the row.
 */
export async function exchangeHandoff(handoff: string): Promise<{ token: string; user: User }> {
  const invalid = new Error("This sign-in link has expired. Sign in with your email instead.");
  if (typeof handoff !== "string" || !isHandoffToken(handoff)) throw invalid;
  const hubDb = db();
  const spent = await hubDb
    .from("sessions")
    .delete()
    .eq("token", sha256Hex(handoff))
    .select<{ user_id: string; expires_at: string; assurance: SessionAssurance }>("user_id, expires_at, assurance");
  const row = spent[0];
  if (!row || Date.now() > Date.parse(row.expires_at)) throw invalid;
  const found = await hubDb.from("users").select("*").eq("id", row.user_id).maybeSingle();
  if (!found) throw invalid;
  const token = await insertSession(hubDb, row.user_id, row.assurance);
  return { token, user: rowToUser(found) };
}

/**
 * Step 3: Affirm residency (and record the user's real name when the
 * sign-up gate supplies one — the gate collects both in one step).
 * Must be called after authentication.
 */
export async function affirmResidency(
  userId: string,
  fullName?: string,
): Promise<User> {
  const patch: Record<string, unknown> = { is_resident: true };
  if (fullName !== undefined) {
    patch.full_name = normalizeFullName(fullName);
  }
  const data = await db()
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select()
    .maybeSingle();

  if (!data) throw new Error("User not found");

  console.log(`[auth] User ${userId} affirmed residency`);
  return rowToUser(data);
}

/**
 * Set the user's real name. Used by the re-gate flow for accounts that
 * pre-date the required-name policy (already residents, just missing a
 * name) and by profile settings.
 */
export async function updateFullName(
  userId: string,
  fullName: string,
): Promise<User> {
  const value = normalizeFullName(fullName);
  const data = await db()
    .from("users")
    .update({ full_name: value })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (!data) throw new Error("User not found");
  return rowToUser(data);
}

/**
 * Slice 11 — record that this user has accepted the named version of
 * the Hub's legal documents (Terms / Privacy / Code of Conduct, treated
 * as a single bundle). Stamps both the version and the wall-clock time.
 * The UI bumps `version` whenever any of the three docs ships a
 * material revision, which forces every existing user back through the
 * re-acceptance modal on next sign-in.
 */
export async function acceptLegalTerms(
  userId: string,
  version: string,
): Promise<User> {
  const now = new Date().toISOString();
  const data = await db()
    .from("users")
    .update({ tos_version_accepted: version, tos_accepted_at: now })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (!data) throw new Error("User not found");
  console.log(`[auth] User ${userId} accepted legal v${version}`);
  return rowToUser(data);
}

// --- Session management ---

/**
 * Get user from a session token. Returns undefined if the token is invalid
 * or expired. Expired sessions are cleaned up opportunistically.
 */
export async function getUserFromToken(
  token: string,
): Promise<User | undefined> {
  return (await getSessionFromToken(token))?.user;
}

/** A signed-in caller: the account, and how the session was proved. */
export interface SessionInfo {
  user: User;
  assurance: SessionAssurance;
}

/**
 * The session a token belongs to, or undefined. A DEMO session (Audit 2)
 * reads as no session at all when the hub is not a demo any more, or when its
 * address has become privileged since: the triggers in 20261011100000 delete
 * such sessions as it happens, and this is the same rule at read time, so no
 * code path that checks a role by email can be reached by one.
 */
export async function getSessionFromToken(
  token: string,
): Promise<SessionInfo | undefined> {
  if (!token) return undefined;
  // A handoff token is exchanged once (exchangeHandoff), never used as a session.
  if (isHandoffToken(token)) return undefined;

  // The hub filter is the point, not an optimisation. A token is valid only
  // on the hub it was minted on: a resident of a demo hub holding a session
  // must not be authenticated on a real jurisdiction's hub served by the same
  // deployment. A token presented to the wrong hub reads as no session at
  // all, which is what it is — and so does a session whose user belongs to
  // another hub, since the user is looked up on this hub too.
  //
  // Outside a request there is no hub, and so no session: nothing outside a
  // request authenticates users.
  const hubId = currentHubIdOrNull();
  if (!hubId) return undefined;
  const hubDb = forHub(hubId);

  // A lookup that fails reads as no session, as it always has: a database
  // error must not authenticate anyone, and a sign-in check is not the place
  // to turn a blip into a 500 on every page.
  try {
    const tokenHash = sha256Hex(token);
    const session = await hubDb
      .from("sessions")
      .select<{ user_id: string; expires_at: string; assurance: SessionAssurance }>(
        "user_id, expires_at, assurance",
      )
      .eq("token", tokenHash)
      .maybeSingle();
    if (!session) return undefined;

    if (new Date() > new Date(session.expires_at)) {
      // Opportunistic cleanup of the expired session.
      await hubDb.from("sessions").delete().eq("token", tokenHash);
      return undefined;
    }

    const assurance: SessionAssurance = session.assurance === "code" ? "code" : "demo";
    if (assurance === "demo" && !isDemoHubSync()) return undefined;

    const row = await hubDb
      .from("users")
      .select("*")
      .eq("id", session.user_id)
      .maybeSingle();
    if (!row) return undefined;
    const user = rowToUser(row);
    // isPrivilegedEmail fails closed (true on a read error), so a wobble
    // signs a demo visitor out rather than letting one through.
    if (assurance === "demo" && (await isPrivilegedEmail(user.email))) return undefined;
    return { user, assurance };
  } catch (err) {
    console.error(`[auth] session lookup failed: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Get user by ID.
 */
export async function getUser(userId: string): Promise<User | undefined> {
  try {
    const data = await db().from("users").select("*").eq("id", userId).maybeSingle();
    return data ? rowToUser(data) : undefined;
  } catch (err) {
    console.error(`[auth] getUser failed: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Logout — destroy session.
 */
export async function logout(token: string): Promise<void> {
  if (!token) return;
  // Scoped for the same reason the lookup is: one hub must not be able to
  // destroy a session belonging to another.
  const hubId = currentHubIdOrNull();
  if (!hubId) return;
  await forHub(hubId).from("sessions").delete().eq("token", sha256Hex(token));
}

/**
 * Slice 13.11 — self-service account deletion. Removes the user row,
 * which cascades to sessions (FK ON DELETE CASCADE). Pending email
 * verifications are keyed by email separately and need a manual
 * delete so the email is fully reusable for a fresh sign-up.
 *
 * Intentionally orphans references that don't have FK cascade:
 *   - proposal_supports.user_id
 *   - vote_participation.user_id
 *   - community_inputs.author_id
 *   - any event.actor strings that mention the user's id
 *
 * Those rows stay so the public record (vote tallies, comments,
 * endorsements) doesn't get retroactively erased. The deleted
 * user's identity is gone — anything that references their id
 * resolves to nothing on join, which the UI renders as no
 * attribution (the desired GDPR-style anonymization without
 * mutilating the civic record).
 *
 * vote_records have NO user_id by design (Slice 4), so individual
 * vote secrecy is preserved automatically.
 */
export async function deleteAccount(
  userId: string,
  email: string,
): Promise<void> {
  if (!userId || !email) {
    throw new Error("Auth: deleteAccount requires both userId and email.");
  }
  const hubDb = db();
  // pending_verifications first so a stale code can't be used to
  // race a fresh signup against the in-flight delete. This hub's only: the
  // same person's account on another hub is theirs to delete there.
  await hubDb.from("pending_verifications").delete().eq("email", email.toLowerCase());
  await hubDb.from("users").delete().eq("id", userId);
}

/**
 * Update the user's public display name. Used by admins to set
 * individual names on Board / committee accounts so announcements
 * carry personal attribution ("Jane Doe, Board member") rather than
 * just the role label.
 */
/**
 * Persistent "Hide AI drafting help" preference. Server-side (not
 * localStorage) so it follows the user across devices. Requires the
 * hide_ai_drafting_help migration; fails loudly against an un-migrated
 * database on purpose — reads degrade to false, writes must not lie.
 */
export async function updateHideAiDraftingHelp(
  userId: string,
  hide: boolean,
): Promise<User> {
  const data = await db()
    .from("users")
    .update({ hide_ai_drafting_help: hide })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (!data) throw new Error("User not found");
  return rowToUser(data);
}

export async function updateDisplayName(
  userId: string,
  displayName: string | null,
): Promise<User> {
  const value = displayName?.trim() || null;
  const data = await db()
    .from("users")
    .update({ display_name: value })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (!data) throw new Error("User not found");
  return rowToUser(data);
}

// --- Digest subscription (Slice 5) ---

/**
 * Set the digest frequency for a user. null = unsubscribed,
 * 1 = daily, 3 = every 3 days, 7 = weekly, etc.
 * Called by the UI settings dropdown and by the unsubscribe endpoint.
 */
export async function setDigestFrequency(
  userId: string,
  frequencyDays: number | null,
): Promise<User> {
  const data = await db()
    .from("users")
    .update({ digest_frequency_days: frequencyDays })
    .eq("id", userId)
    .select()
    .maybeSingle();

  if (!data) throw new Error("User not found");
  return rowToUser(data);
}

/**
 * Record that a digest was successfully delivered to a user. Updates the
 * "since" cursor so the next run picks up only new activity. Called by
 * the cron endpoint after a successful Resend send.
 */
export async function markDigestSent(
  hubId: string,
  userId: string,
  timestamp: string,
): Promise<void> {
  await forHub(hubId)
    .from("users")
    .update({ last_digest_sent_at: timestamp })
    .eq("id", userId);
}

/**
 * List every user on one hub currently subscribed to the digest
 * (frequency > 0). The cron endpoint iterates this set and checks per-user
 * timing. Returns an empty array when nobody is subscribed.
 *
 * Takes the hub explicitly because the digest cron runs outside a request.
 */
export async function listSubscribedUsers(hubId: string): Promise<User[]> {
  // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
  const rows = await readAll((from, to) =>
    forHub(hubId)
      .from("users")
      .select("*")
      .not("digest_frequency_days", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => rowToUser(row));
}

/** Clear this hub's auth data — used by debug/seed only. */
export async function clearAuth(): Promise<void> {
  const hubDb = db();
  // Supabase requires a filter on DELETE to avoid accidental full-table wipes.
  // neq("<col>", "") matches every row since our IDs/emails are non-empty;
  // forHub confines it to this hub.
  await hubDb.from("pending_verifications").delete().neq("email", "");
  await hubDb.from("sessions").delete().neq("token", "");
  await hubDb.from("users").delete().neq("id", "");
}
