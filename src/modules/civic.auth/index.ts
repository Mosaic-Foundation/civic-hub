// civic.auth module — email-based authentication service
//
// Minimal auth for civic participation:
//   1. User enters email → OTP code generated
//   2. User verifies with code → account created/logged in
//   3. User affirms residency → is_resident = true
//
// Storage: Postgres via Supabase (tables: users, sessions, sign_in_codes)
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

import { env } from "../../config/env.js";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationError } from "../../errors/index.js";
import { forHub, HubDbError, type HubDb, type Row } from "../../db/forHub.js";
import { generateId } from "../../utils/id.js";
import { randomToken, sameHexHash, sha256Hex } from "../../utils/hash.js";
import { renderCodeEmail } from "./otp.js";
import { CODE_RULES, checkCode, issueCode, tooManyMessage, type CodeRow, type CodeStore, type Realm } from "./codeRules.js";
import { sendEmail } from "../../utils/email.js";
import { HUB_SIGN_IN_LIMITS } from "./limits.js";
import { HOUR_MS, retryAt, takeRateLimit } from "../../db/rateLimit.js";
import { KEYS } from "../../models/hubSettings.js";
import { resolveTimeZone } from "../../utils/hubTime.js";
import { uiBaseUrl } from "../../utils/baseUrl.js";
import {
  getAdminEmailsSync,
  getBoardEmailsSync,
  isBetaEnabledSync,
  isDemoHubSync,
  isEmailOnBetaAllowlist,
  hubDisplayNameSync,
  getSettingSync,
} from "../../services/hubSettings.js";
import { isPrivilegedEmail, isPrivilegedEmailNow } from "../../services/privilegedAccounts.js";
import { lookupOfficialByEmail } from "../../services/officials.js";
import { currentHubId, currentHubIdOrNull } from "../../config/hubContext.js";
import type { User, PendingVerification, Session, SessionAssurance } from "./models.js";
import { readAll } from "../../db/readAll.js";

export type { User, PendingVerification, Session, SessionAssurance } from "./models.js";

// --- Constants ---

/**
 * How long a session lasts (Adam, 2026-10-13): a week, or 90 days when "Keep
 * me signed in" is ticked. Sessions from before keep the 30 days they were
 * given. The code's rules live in ./codeRules.ts, shared with the console and
 * the start page.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const KEEP_SIGNED_IN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
    hidden_from_members: Boolean(row.hidden_from_members),
    display_name: row.display_name ? String(row.display_name) : null,
    full_name: row.full_name ? String(row.full_name) : null,
  };
}

/** Shared validation for real names — used by sign-up and profile update. */
export function normalizeFullName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (value.length < 2) {
    throw new ValidationError("Please enter your full name", "name_required");
  }
  if (value.length > 100) {
    throw new ValidationError("Name must be 100 characters or fewer", "name_too_long");
  }
  return value;
}

// --- Auth flow ---

/** This hub's codes (sign_in_codes, 20261014000000), for ./codeRules.ts. */
function hubCodeStore(hubDb: HubDb): CodeStore {
  return {
    async live(email) {
      const rows = await hubDb
        .from("sign_in_codes")
        .select<{ expires_at: string; attempts: number }>("expires_at, attempts")
        .eq("email", email)
        .gt("expires_at", new Date().toISOString());
      return rows.filter((r) => r.attempts < CODE_RULES.maxTries).map((r) => r.expires_at);
    },
    async insert(row) {
      await hubDb.from("sign_in_codes").insert(row);
    },
    async take(by, maxTries) {
      const rows = await hubDb.rpc<CodeRow[]>("take_sign_in_attempt", {
        p_email: "email" in by ? by.email : null,
        p_link_hash: "linkHash" in by ? by.linkHash : null,
        p_max: maxTries,
      });
      return Array.isArray(rows) ? rows : [];
    },
    async spend(id) {
      const spent = await hubDb.from("sign_in_codes").delete().eq("id", id).select<{ id: string }>("id");
      return spent.length > 0;
    },
    async clear(email) {
      await hubDb.from("sign_in_codes").delete().eq("email", email);
    },
  };
}

/** A hub's realm: its per-IP caps (./limits.ts), its time zone, and links. */
function hubRealm(): Realm {
  const hubId = currentHubId();
  return {
    scope: "hub",
    addressKey: (email) => `${hubId}:${email}`,
    ipLimits: { request: HUB_SIGN_IN_LIMITS.request_code.ip, verify: HUB_SIGN_IN_LIMITS.verify.ip },
    timeZone: resolveTimeZone(getSettingSync(KEYS.IDENTITY_TIMEZONE)),
    links: true,
  };
}

/** Count one step against the IP's hourly cap, or refuse with the time it can try again. */
async function limitIp(step: keyof typeof HUB_SIGN_IN_LIMITS, ip: string, timeZone: string): Promise<void> {
  const check = { scope: `hub.${step}`, by: "ip", value: ip, limit: HUB_SIGN_IN_LIMITS[step].ip, windowMs: HOUR_MS };
  if (!(await takeRateLimit([check]))) return;
  const at = (await retryAt(check)) ?? new Date(Date.now() + HOUR_MS);
  throw new RateLimitedError(tooManyMessage(at, timeZone), "rate_limited", { extra: { retry_at: at.toISOString() } });
}

/**
 * A beta hub admits its admin roster, its allow list, and its officials
 * (Adam, 2026-10-07): anyone an admin entered in the officials list is
 * treated as if on the allow list for signing in. Only for signing in: the
 * mail guard still holds notifications to officials on a demo or beta hub
 * (mailGuard.ts), and their sign-in code passes it as every code does.
 * Checked when a code is asked for, and when an invite link is used.
 *
 * Board members too (Adam, 2026-10-15, leaving-demo slice): an admin who has
 * just added someone under Admins & board should not find them turned away
 * in beta. Sign-in only, like officials: the mail guard is unchanged.
 */
async function assertMayEnterBeta(normalizedEmail: string): Promise<void> {
  if (!isBetaEnabledSync()) return;
  if (getAdminEmailsSync().includes(normalizedEmail)) return;
  if (getBoardEmailsSync().includes(normalizedEmail)) return;
  const allowed =
    (await isEmailOnBetaAllowlist(currentHubId(), normalizedEmail)) ||
    (await lookupOfficialByEmail(normalizedEmail)) !== null;
  if (!allowed) {
    throw new ForbiddenError("This hub is currently in private beta.", "beta_closed");
  }
}

/** Where the email's "Sign in" link goes: the hub's page, the token after `#`. */
export function signInLink(linkToken: string): string {
  return `${uiBaseUrl()}/sign-in#t=${linkToken}`;
}

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
    throw new ValidationError("Invalid email address", "invalid_email");
  }

  // Counted first, before anything is looked up or sent: a request refused
  // here costs nothing, and a demo hub's requests and a beta hub's refusals
  // count too, so the form can't be used to probe who is on the list.
  const realm = hubRealm();
  await limitIp("request_code", ip, realm.timeZone);

  // A demo hub does not email sign-in codes. Any visitor can look around, so
  // no code is made, stored or sent: a demo signup should not mail a
  // throwaway address, burn Resend quota, or confuse someone who was not
  // expecting an email. It still counts against the IP (Audit 2).
  //
  // The test is per hub (Phase 1 part two): one deployment serves every hub,
  // so NODE_ENV says nothing, and `beta.demo_mode` is an admin-only settings
  // row that a live hub simply does not have. A demo hub accepts any six
  // digits, so there is no code to display, compile in or leak.
  //
  // A PRIVILEGED account gets the real flow even here. An admin or an
  // official can moderate, publish, and change what the hub is; "any six
  // digits" for those accounts would mean anyone who knows an admin's email
  // address can be that admin.
  if (isDemoHubSync() && !(await isPrivilegedEmailNow(normalizedEmail))) {
    console.log(`[auth] Demo hub signin for ${normalizedEmail} — no code emailed.`);
    // `no_email` tells the sign-in screen not to say "Check your email"
    // (review R22): nothing was sent.
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
  await assertMayEnterBeta(normalizedEmail);

  // Three live codes, the IP's requests, one email a minute and ten new codes
  // an hour for the address; then a new code beside any earlier ones, which
  // keep working (./codeRules.ts). Nothing here can lock the address.
  // The IP was counted above, so issueCode doesn't count it again.
  const issued = await issueCode(hubCodeStore(db()), { ...realm, ipLimits: { ...realm.ipLimits, request: null } }, ip, normalizedEmail);
  const code = issued.code;

  // Send the OTP via email. If Resend is not configured (dev), fall back
  // to logging so local development still works.
  const hubDisplayName = hubDisplayNameSync();
  const link = purpose === "sign_in" && issued.linkToken ? signInLink(issued.linkToken) : null;
  const rendered = renderOtpEmail(code, hubDisplayName, purpose, link);
  const result = await sendEmail({
    to: normalizedEmail,
    subject:
      purpose === "step_up"
        ? `${hubDisplayName}: your code to confirm a change`
        : `Your ${hubDisplayName} sign-in code`,
    html: rendered.html,
    text: rendered.text,
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
    if (!env.RESEND_API_KEY) {
      console.log(`\n[auth] Verification code for ${normalizedEmail}: ${code}\n`);
      if (link) console.log(`[auth] Sign-in link for ${normalizedEmail}: ${link}\n`);
    } else {
      console.warn(
        `[auth] The code was NOT logged: a mailer is configured, so this is a ` +
        `delivery failure rather than local development. Fix the mailer.`,
      );
    }
  }

  return { message: "Verification code sent" };
}

function renderOtpEmail(code: string, rawHubName: string, purpose: "sign_in" | "step_up", link: string | null) {
  return purpose === "step_up"
    ? renderCodeEmail(code, rawHubName, "confirm your change", "Your code to confirm a change")
    : renderCodeEmail(code, rawHubName, undefined, undefined, link);
}

/**
 * Check a one-time code and spend it.
 *
 * Extracted from verifyCode so that anything else needing proof of the
 * mailbox — changing a hub's mode, for one — enforces the SAME rules rather
 * than growing its own weaker copy. The tries, expiry, burning and single
 * use all live in ./codeRules.ts, once.
 *
 * Throws on every failure, with the message the caller shows. On success the
 * code's row is deleted, which is what makes it single-use.
 */
export async function consumePendingCode(
  email: string,
  code: string,
  // The caller's IP, for the per-IP limits on codes typed in.
  ip: string,
): Promise<void> {
  await checkCode(hubCodeStore(db()), hubRealm(), ip, { email: email.trim().toLowerCase(), code: String(code) });
}

function sessionTtl(keepSignedIn: boolean): number {
  return keepSignedIn ? KEEP_SIGNED_IN_TTL_MS : SESSION_TTL_MS;
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
  keepSignedIn = false,
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
    await limitIp("verify", ip, hubRealm().timeZone);
    await hubCodeStore(hubDb).clear?.(normalizedEmail);
    assurance = "demo";
  } else {
    await consumePendingCode(normalizedEmail, code, ip);
    assurance = "code";
  }

  const user = await findOrCreateVerifiedUser(normalizedEmail);
  const token = await insertSession(hubDb, user.id, assurance, sessionTtl(keepSignedIn));
  return { token, user };
}

/**
 * The email's "Sign in" link: the page posts its token here after one
 * Confirm. Same code, same rules: checked through the same attempt function,
 * with the same expiry, tries and single use as typing the code. A link is
 * always a real code, so even on a demo hub it makes a "code" session.
 */
export async function verifyLink(
  linkToken: string,
  ip: string,
  keepSignedIn = false,
): Promise<{ token: string; user: User }> {
  const hubDb = db();
  const { email } = await checkCode(hubCodeStore(hubDb), hubRealm(), ip, { linkToken });
  const user = await findOrCreateVerifiedUser(email);
  const token = await insertSession(hubDb, user.id, "code", sessionTtl(keepSignedIn));
  return { token, user };
}

/**
 * A member's invite link (members and invites slice, 2026-10-14): the invite
 * email's "Join" button lands on /sign-in#invite=<token>, the same page as a
 * code's link, with the same one Confirm. The token proves the address the
 * way a code does, since only that mailbox received it. It lasts 14 days and
 * works once (hub_invites.used_at); a used, expired or unknown token is one
 * answer, so the page can't be used to learn which. A beta hub's gate applies
 * as for a code: an address an admin later took off the allow list doesn't
 * get in through an old link.
 */
export async function verifyInviteLink(
  inviteToken: string,
  ip: string,
  keepSignedIn = false,
): Promise<{ token: string; user: User }> {
  await limitIp("verify", ip, hubRealm().timeZone);
  const invalid = new ValidationError(
    "This invite link has expired or has already been used. You can still sign in with your email address.",
    "invite_unusable",
  );
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(inviteToken)) throw invalid;
  const hubDb = db();
  const now = new Date().toISOString();
  const linkHash = sha256Hex(inviteToken);
  const live = await hubDb
    .from("hub_invites")
    .select<{ email: string }>("email")
    .eq("link_hash", linkHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (!live) throw invalid;
  // Before the link is spent, so a refusal here leaves it working for when
  // an admin lets the address in.
  await assertMayEnterBeta(live.email);
  // The spend: one statement, so two taps can't both use it.
  const spent = await hubDb
    .from("hub_invites")
    .update({ used_at: now })
    .eq("link_hash", linkHash)
    .is("used_at", null)
    .select<{ email: string }>("email");
  const email = spent[0]?.email;
  if (!email) throw invalid;
  const user = await findOrCreateVerifiedUser(email);
  const token = await insertSession(hubDb, user.id, "code", sessionTtl(keepSignedIn));
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
        throw new ConflictError(ADDRESS_IN_USE_ELSEWHERE, "address_in_use_elsewhere");
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
export async function createHandoffSession(
  email: string,
  // The legal version the creator agreed to on the start page, by pressing
  // Create beside the notice (sign-in slice, 2026-10-14): recorded here so
  // they aren't asked again as a member of the hub they made.
  agreedLegalVersion?: string,
): Promise<string> {
  const user = await findOrCreateVerifiedUser(email.trim().toLowerCase());
  if (agreedLegalVersion) await acceptLegalTerms(user.id, agreedLegalVersion);
  return insertSession(db(), user.id, "code", HANDOFF_TTL_MS, `${HANDOFF_PREFIX}_${randomToken()}`);
}

/**
 * Spend a handoff token for an ordinary session on the hub in scope. The
 * delete is the spend: of two requests with one token, one gets the row.
 */
export async function exchangeHandoff(handoff: string): Promise<{ token: string; user: User }> {
  const invalid = new UnauthorizedError("This sign-in link has expired. Sign in with your email instead.", "handoff_expired");
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

  if (!data) throw new NotFoundError("User not found", "user_not_found");

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
  if (!data) throw new NotFoundError("User not found", "user_not_found");
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
  if (!data) throw new NotFoundError("User not found", "user_not_found");
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
  // The codes first so a stale code can't be used to race a fresh signup
  // against the in-flight delete. This hub's only: the same person's account
  // on another hub is theirs to delete there.
  await hubDb.from("sign_in_codes").delete().eq("email", email.toLowerCase());
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
  if (!data) throw new NotFoundError("User not found", "user_not_found");
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
  if (!data) throw new NotFoundError("User not found", "user_not_found");
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

  if (!data) throw new NotFoundError("User not found", "user_not_found");
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
  await hubDb.from("sign_in_codes").delete().neq("email", "");
  await hubDb.from("sessions").delete().neq("token", "");
  await hubDb.from("users").delete().neq("id", "");
}
