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
// Until the cleanup migration drops the global `users_email_key` and
// `pending_verifications_pkey (email)`, one address can hold an account (or a
// pending code) on one hub only; a collision with another hub is refused
// with a message that does not say which hub.
//
// GUARDRAIL: This module MUST NOT import from civic.vote or civic.proposals.

import { randomInt } from "node:crypto";
import { forHub, HubDbError, type HubDb, type Row } from "../../db/forHub.js";
import { generateId } from "../../utils/id.js";
import { sendEmail } from "../../utils/email.js";
import {
  getAdminEmailsSync,
  isBetaEnabledSync,
  isDemoHubSync,
  isEmailOnBetaAllowlist,
  hubDisplayNameSync,
} from "../../services/hubSettings.js";
import { isPrivilegedEmail } from "../../services/privilegedAccounts.js";
import { currentHubId, currentHubIdOrNull } from "../../config/hubContext.js";
import type { User, PendingVerification, Session } from "./models.js";

export type { User, PendingVerification, Session } from "./models.js";

// --- Constants ---

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Brute-force defenses (audit P1 — account takeover). Cap wrong guesses per
// code, and throttle how often a fresh code can be requested so an attacker
// can't reset the cap by re-requesting.
const MAX_VERIFY_ATTEMPTS = 5;
const REQUEST_THROTTLE_MS = 30 * 1000; // 30s between code requests per email
// After MAX_VERIFY_ATTEMPTS wrong guesses the email is locked for this long —
// both verifying and requesting a new code are refused until it passes. Caps a
// patient brute-force attacker at 5 guesses per lockout window (negligible),
// while staying forgiving for a legit user who mistyped a few times.
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/** The hub in scope. Everything here runs inside a request for one hub. */
function db(): HubDb {
  return forHub(currentHubId());
}

/**
 * Shown when an address collides with the still-global unique email on
 * another hub. Deliberately does not name the hub, or say that there is one.
 */
const ADDRESS_IN_USE_ELSEWHERE =
  "This address can't be used to sign in to this hub yet. Please use a different address.";

// --- OTP / token generation ---

function generateOTP(): string {
  // Cryptographically secure — Math.random() is predictable and unfit for a
  // security credential.
  return randomInt(100000, 1000000).toString();
}

/** Human-friendly "try again in ~N minutes" message for a lockout. */
function lockoutMessage(lockedUntilIso: string): string {
  const mins = Math.max(
    1,
    Math.ceil((new Date(lockedUntilIso).getTime() - Date.now()) / 60000),
  );
  return `Too many incorrect attempts. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
}

function generateToken(): string {
  return generateId("sess");
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
): Promise<{ message: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Invalid email address");
  }

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
  if (isDemoHubSync() && !(await isPrivilegedEmail(normalizedEmail))) {
    console.log(
      `[auth] Demo hub signin for ${normalizedEmail} — no code emailed.`,
    );
    return {
      message: "This is a demo hub. Enter any six digits to sign in.",
    };
  }

  if (isBetaEnabledSync()) {
    const adminEmails = getAdminEmailsSync();
    if (!adminEmails.includes(normalizedEmail)) {
      const allowed = await isEmailOnBetaAllowlist(currentHubId(), normalizedEmail);
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
        code,
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
        attempts: 0, // fresh code, reset the wrong-guess counter
        locked_until: null, // and clear any expired lockout
      },
      { onConflict: "hub_id,email" },
    );
  } catch (err) {
    // 23505 on (hub_id, email) cannot happen — that is the conflict target —
    // so it is the global primary key: this address has a pending code on
    // another hub.
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
    subject: `Your ${hubDisplayName} sign-in code`,
    html: renderOtpEmail(code, hubDisplayName),
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

function renderOtpEmail(code: string, rawHubName: string): string {
  // The hub's display name is admin-authored text, so it is escaped before it
  // goes into HTML like anything else a person typed.
  const hubDisplayName = rawHubName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
      <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">Your sign-in code</h1>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
        Enter this code in the ${hubDisplayName} to finish signing in:
      </p>
      <div style="font-size: 32px; font-weight: 600; letter-spacing: 8px; background: #f3f4f6; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 0 0 24px;">
        ${code}
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0 0 8px;">
        This code expires in 10 minutes. If you didn't request it, you can ignore this email.
      </p>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0;">
        — The ${hubDisplayName}
      </p>
    </div>
  `;
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
 * `pending` may be passed in when the caller has already fetched it, to avoid
 * a second read of the same row.
 */
export async function consumePendingCode(
  email: string,
  code: string,
  pending?: {
    code: string;
    expires_at: string;
    attempts?: number | null;
    locked_until?: string | null;
  } | null,
): Promise<void> {
  const hubDb = db();
  const normalizedEmail = email.trim().toLowerCase();

  let row = pending;
  if (row === undefined) {
    row = await hubDb
      .from("pending_verifications")
      .select<{
        code: string;
        expires_at: string;
        attempts: number | null;
        locked_until: string | null;
      }>("*")
      .eq("email", normalizedEmail)
      .maybeSingle();
  }

  if (!row) {
    throw new Error(
      "No pending verification for this email. Request a new code.",
    );
  }
  // Lockout: if the email is in its post-brute-force cooldown, refuse to
  // verify regardless of the code entered.
  if (row.locked_until && new Date() < new Date(row.locked_until)) {
    throw new Error(lockoutMessage(row.locked_until));
  }
  if (new Date() > new Date(row.expires_at)) {
    await hubDb
      .from("pending_verifications")
      .delete()
      .eq("email", normalizedEmail);
    throw new Error("Verification code expired. Request a new code.");
  }
  if (row.code !== code) {
    // Count the wrong guess; after MAX_VERIFY_ATTEMPTS, lock the email for
    // LOCKOUT_MS (both verify and request-code refuse until it passes). This
    // is the core anti-brute-force defense.
    const attempts = (row.attempts ?? 0) + 1;
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      await hubDb
        .from("pending_verifications")
        .update({ attempts, locked_until: lockedUntil })
        .eq("email", normalizedEmail);
      throw new Error(lockoutMessage(lockedUntil));
    }
    await hubDb
      .from("pending_verifications")
      .update({ attempts })
      .eq("email", normalizedEmail);
    throw new Error("Invalid verification code");
  }
  // Spend it. A code works once.
  await hubDb
    .from("pending_verifications")
    .delete()
    .eq("email", normalizedEmail);
}

/**
 * Step 2: Verify the code and create/login user.
 * Returns a session token and user object.
 */
export async function verifyCode(
  email: string,
  code: string,
): Promise<{ token: string; user: User }> {
  const normalizedEmail = email.trim().toLowerCase();
  const hubDb = db();

  // --- Validate the OTP ---
  const pending = await hubDb
    .from("pending_verifications")
    .select<{
      code: string;
      expires_at: string;
      attempts: number | null;
      locked_until: string | null;
    }>("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  // A demo hub accepts any six digits from an ordinary visitor (see
  // requestVerification). Gated on the hub's own `mode`, which lives only in
  // the database, so nothing in a deployment's configuration can turn this on
  // for a hub that is not a demo.
  //
  // Privileged accounts are excluded and fall through to the real code path,
  // because an admin who can be impersonated by typing six digits is not an
  // admin. The shape check keeps the form's validation honest and stops an
  // empty submission walking in.
  if (
    isDemoHubSync() &&
    !(await isPrivilegedEmail(normalizedEmail)) &&
    /^\d{6}$/.test(code.trim())
  ) {
    if (pending) {
      await hubDb
        .from("pending_verifications")
        .delete()
        .eq("email", normalizedEmail);
    }
  } else {
    await consumePendingCode(normalizedEmail, code, pending);
  }

  // --- Find or create the user, on this hub ---
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
        // Not on this hub: the violation was the global users_email_key,
        // so the address has an account on another hub.
        console.warn(`[auth] ${normalizedEmail} has an account on another hub (global key)`);
        throw new Error(ADDRESS_IN_USE_ELSEWHERE);
      }
      user = rowToUser(refetch);
    }
  }

  // --- Create a session ---
  const token = generateToken();
  const sessionExpires = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  // Stamped with the hub it was minted on, by forHub. A session is a bearer
  // credential, so without this a token from one hub would authenticate its
  // holder on every other hub this deployment serves.
  await hubDb.from("sessions").insert({
    token,
    user_id: user.id,
    expires_at: sessionExpires,
  });

  return { token, user };
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
  if (!token) return undefined;

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
    const session = await hubDb
      .from("sessions")
      .select<{ user_id: string; expires_at: string }>("user_id, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!session) return undefined;

    if (new Date() > new Date(session.expires_at)) {
      // Opportunistic cleanup of the expired session.
      await hubDb.from("sessions").delete().eq("token", token);
      return undefined;
    }

    const user = await hubDb
      .from("users")
      .select("*")
      .eq("id", session.user_id)
      .maybeSingle();
    return user ? rowToUser(user) : undefined;
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
  await forHub(hubId).from("sessions").delete().eq("token", token);
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
  const rows = await forHub(hubId)
    .from("users")
    .select("*")
    .not("digest_frequency_days", "is", null);
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
