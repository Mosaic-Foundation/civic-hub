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
// GUARDRAIL: This module MUST NOT import from civic.vote or civic.proposals.

import { randomInt } from "node:crypto";
import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import { sendEmail } from "../../utils/email.js";
import { isEmailOnBetaAllowlist } from "../../services/hubSettings.js";
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

  // Slice 19c — when CIVIC_DEMO_BYPASS_CODE is set, the deployment
  // is a demo (e.g. demo-hub.civic.social) where any visitor signs
  // in with the displayed bypass code instead of a real OTP. Skip
  // the OTP generation, the pending_verifications insert, and the
  // Resend send entirely so demo signups don't:
  //   1. fire a real email to throwaway addresses,
  //   2. burn against the Resend monthly quota,
  //   3. confuse visitors who weren't expecting an email and now
  //      wonder why one arrived with a different code than the one
  //      the IntroPopup told them to use.
  // verifyCode() already accepts the bypass code without needing a
  // pending_verifications row (it short-circuits the existence
  // check), so skipping the insert here doesn't break the flow.
  // The demo bypass is inert in production: even if CIVIC_DEMO_BYPASS_CODE is
  // accidentally set on a prod deployment, it resolves to undefined here, so
  // the static code can never skip real OTP in prod. Fail-safe (inert), not
  // fail-loud (refuse-to-boot) — a misconfig can't cause an outage.
  const demoBypass =
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.CIVIC_DEMO_BYPASS_CODE?.trim();
  if (demoBypass) {
    console.log(
      `[auth] Demo-mode signin requested for ${normalizedEmail} — bypass code active, skipping email.`,
    );
    return {
      message: "Demo mode — use the displayed bypass code to sign in.",
    };
  }

  if (process.env.CIVIC_BETA_MODE === "true") {
    const adminEmails = (process.env.CIVIC_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);
    if (!adminEmails.includes(normalizedEmail)) {
      const allowed = await isEmailOnBetaAllowlist(normalizedEmail);
      if (!allowed) {
        throw new Error("This hub is currently in private beta.");
      }
    }
  }

  const { data: recent } = await getDb()
    .from("pending_verifications")
    .select("created_at, locked_until")
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

  const { error } = await getDb()
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
      { onConflict: "email" },
    );

  if (error) {
    throw new Error(`Auth: failed to store verification: ${error.message}`);
  }

  // Send the OTP via email. If Resend is not configured (dev), fall back
  // to logging so local development still works.
  const result = await sendEmail({
    to: normalizedEmail,
    subject: "Your Floyd Civic Hub sign-in code",
    html: renderOtpEmail(code),
  });

  if (result.sent) {
    console.log(`[auth] Sent verification code to ${normalizedEmail} (resend id: ${result.id})`);
  } else {
    // Fallback: log to console so dev/preview still works without a key.
    // In production, misconfiguration here would be silent to the user, so
    // we log the failure prominently. The user still gets "code sent"
    // because we don't want to leak whether the address is deliverable.
    console.warn(
      `[auth] Email NOT sent for ${normalizedEmail} (${result.error}). ` +
      `Falling back to console log (dev only).`,
    );
    console.log(`\n[auth] Verification code for ${normalizedEmail}: ${code}\n`);
  }

  return { message: "Verification code sent" };
}

function renderOtpEmail(code: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
      <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">Your sign-in code</h1>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
        Enter this code in the Floyd Civic Hub to finish signing in:
      </p>
      <div style="font-size: 32px; font-weight: 600; letter-spacing: 8px; background: #f3f4f6; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 0 0 24px;">
        ${code}
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0 0 8px;">
        This code expires in 10 minutes. If you didn't request it, you can ignore this email.
      </p>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0;">
        — The Floyd Civic Hub
      </p>
    </div>
  `;
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
  const db = getDb();

  // --- Validate the OTP ---
  const { data: pending, error: pendErr } = await db
    .from("pending_verifications")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (pendErr) throw new Error(`Auth: ${pendErr.message}`);

  // Inert in production (see requestCode): a prod deployment with the var set
  // still cannot be bypassed, because this resolves to undefined there.
  const demoBypass =
    process.env.NODE_ENV === "production"
      ? undefined
      : process.env.CIVIC_DEMO_BYPASS_CODE;
  if (demoBypass && code === demoBypass) {
    // Demo-mode bypass — only active outside production (dev/preview).
    if (pending) {
      await db
        .from("pending_verifications")
        .delete()
        .eq("email", normalizedEmail);
    }
  } else {
    if (!pending) {
      throw new Error(
        "No pending verification for this email. Request a new code.",
      );
    }
    // Lockout: if the email is in its post-brute-force cooldown, refuse to
    // verify regardless of the code entered.
    if (
      pending.locked_until &&
      new Date() < new Date(pending.locked_until)
    ) {
      throw new Error(lockoutMessage(pending.locked_until));
    }
    if (new Date() > new Date(pending.expires_at)) {
      await db
        .from("pending_verifications")
        .delete()
        .eq("email", normalizedEmail);
      throw new Error("Verification code expired. Request a new code.");
    }
    if (pending.code !== code) {
      // Count the wrong guess; after MAX_VERIFY_ATTEMPTS, lock the email for
      // LOCKOUT_MS (both verify and request-code refuse until it passes). This
      // is the core anti-brute-force defense.
      const attempts = (pending.attempts ?? 0) + 1;
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
        await db
          .from("pending_verifications")
          .update({ attempts, locked_until: lockedUntil })
          .eq("email", normalizedEmail);
        throw new Error(lockoutMessage(lockedUntil));
      }
      await db
        .from("pending_verifications")
        .update({ attempts })
        .eq("email", normalizedEmail);
      throw new Error("Invalid verification code");
    }
    await db
      .from("pending_verifications")
      .delete()
      .eq("email", normalizedEmail);
  }

  // --- Find or create the user ---
  const { data: existing, error: selErr } = await db
    .from("users")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (selErr) throw new Error(`Auth: ${selErr.message}`);

  let user: User;

  if (existing) {
    // Mark email_verified if it wasn't already
    if (!existing.email_verified) {
      const { data, error } = await db
        .from("users")
        .update({ email_verified: true })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new Error(`Auth: ${error.message}`);
      user = rowToUser(data);
    } else {
      user = rowToUser(existing);
    }
  } else {
    // Create new user. Race-safe: unique(email) will reject duplicates.
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

    const { data, error } = await db
      .from("users")
      .insert(newRow)
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation — another request created the user first.
      if (error.code === "23505") {
        const { data: refetch, error: refErr } = await db
          .from("users")
          .select("*")
          .eq("email", normalizedEmail)
          .single();
        if (refErr) throw new Error(`Auth: ${refErr.message}`);
        user = rowToUser(refetch);
      } else {
        throw new Error(`Auth: ${error.message}`);
      }
    } else {
      user = rowToUser(data);
      console.log(`[auth] New user created: ${user.id} (${normalizedEmail})`);
    }
  }

  // --- Create a session ---
  const token = generateToken();
  const sessionExpires = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error: sessErr } = await db.from("sessions").insert({
    token,
    user_id: user.id,
    expires_at: sessionExpires,
  });

  if (sessErr) throw new Error(`Auth: ${sessErr.message}`);

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
  const { data, error } = await getDb()
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Auth: ${error.message}`);
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
  const { data, error } = await getDb()
    .from("users")
    .update({ full_name: value })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Auth: ${error.message}`);
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
  const { data, error } = await getDb()
    .from("users")
    .update({ tos_version_accepted: version, tos_accepted_at: now })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Auth: ${error.message}`);
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
  const db = getDb();

  const { data: session, error } = await db
    .from("sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !session) return undefined;

  if (new Date() > new Date(session.expires_at)) {
    // Opportunistic cleanup of the expired session.
    await db.from("sessions").delete().eq("token", token);
    return undefined;
  }

  const { data: user, error: userErr } = await db
    .from("users")
    .select("*")
    .eq("id", session.user_id)
    .maybeSingle();

  if (userErr || !user) return undefined;
  return rowToUser(user);
}

/**
 * Get user by ID.
 */
export async function getUser(userId: string): Promise<User | undefined> {
  const { data, error } = await getDb()
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return undefined;
  return rowToUser(data);
}

/**
 * Logout — destroy session.
 */
export async function logout(token: string): Promise<void> {
  if (!token) return;
  await getDb().from("sessions").delete().eq("token", token);
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
  const db = getDb();
  // pending_verifications first so a stale code can't be used to
  // race a fresh signup against the in-flight delete.
  await db.from("pending_verifications").delete().eq("email", email.toLowerCase());
  const { error } = await db.from("users").delete().eq("id", userId);
  if (error) throw new Error(`Auth: ${error.message}`);
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
  const { data, error } = await getDb()
    .from("users")
    .update({ hide_ai_drafting_help: hide })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Auth: ${error.message}`);
  if (!data) throw new Error("User not found");
  return rowToUser(data);
}

export async function updateDisplayName(
  userId: string,
  displayName: string | null,
): Promise<User> {
  const value = displayName?.trim() || null;
  const { data, error } = await getDb()
    .from("users")
    .update({ display_name: value })
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Auth: ${error.message}`);
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
  const { data, error } = await getDb()
    .from("users")
    .update({ digest_frequency_days: frequencyDays })
    .eq("id", userId)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Auth: ${error.message}`);
  if (!data) throw new Error("User not found");
  return rowToUser(data);
}

/**
 * Record that a digest was successfully delivered to a user. Updates the
 * "since" cursor so the next run picks up only new activity. Called by
 * the cron endpoint after a successful Resend send.
 */
export async function markDigestSent(
  userId: string,
  timestamp: string,
): Promise<void> {
  const { error } = await getDb()
    .from("users")
    .update({ last_digest_sent_at: timestamp })
    .eq("id", userId);
  if (error) throw new Error(`Auth: ${error.message}`);
}

/**
 * List every user currently subscribed to the digest (frequency > 0).
 * The cron endpoint iterates this set and checks per-user timing.
 * Returns an empty array when nobody is subscribed.
 */
export async function listSubscribedUsers(): Promise<User[]> {
  const { data, error } = await getDb()
    .from("users")
    .select("*")
    .not("digest_frequency_days", "is", null);
  if (error) throw new Error(`Auth: ${error.message}`);
  return (data ?? []).map((row) => rowToUser(row));
}

/** Clear all auth data — used by debug/seed only. */
export async function clearAuth(): Promise<void> {
  const db = getDb();
  // Supabase requires a filter on DELETE to avoid accidental full-table wipes.
  // neq("<col>", "") matches every row since our IDs/emails are non-empty.
  await db.from("pending_verifications").delete().neq("email", "");
  await db.from("sessions").delete().neq("token", "");
  await db.from("users").delete().neq("id", "");
}
