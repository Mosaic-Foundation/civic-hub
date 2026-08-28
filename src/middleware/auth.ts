// Auth middleware — enforces identity on action endpoints.
//
// Three guards, ordered from loosest to strictest:
//   requireAuth      — valid session token (user exists, token not expired)
//   requireResident  — requireAuth + user.is_resident === true
//   requireAdmin     — requireAuth + email ∈ CIVIC_ADMIN_EMAILS
//
// The authenticated user is placed on `res.locals.authUser`. Controllers
// read the actor from there, NOT from request bodies. This closes the hole
// where any caller could POST { actor: "<anyone>" } and act as that user.

import { NextFunction, Request, Response } from "express";
import { getUserFromToken, type User } from "../modules/civic.auth/index.js";
import { areOfficialsMigrated, lookupAuthor } from "../services/hubSettings.js";
import { lookupOfficialByEmail } from "../services/officials.js";
import {
  type OfficialIdentity,
  inferOfficialType,
  toOfficialIdentity,
} from "../shared/officialTypes.js";

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

function parseEmailList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

function adminEmails(): Set<string> {
  return parseEmailList(process.env.CIVIC_ADMIN_EMAILS);
}

function boardEmails(): Set<string> {
  return parseEmailList(process.env.CIVIC_BOARD_EMAILS);
}

/**
 * Quick sync admin check. Use when the DB-backed author list is not needed
 * (e.g. gating /admin/*). For announcement posting where the author label
 * matters, use `resolveAuthorship()` below.
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().has(email.toLowerCase());
}

/**
 * Resolve an account's official identity — the public office rendered as
 * a pill next to their name.
 *
 * Three tiers, most authoritative first:
 *   1. users.official_type / official_title — the managed role
 *   2. hub_settings.announcement_authors    — the legacy email-keyed list,
 *      whose free-form label becomes the title and whose type is inferred.
 *      getAnnouncementAuthors() itself falls back to CIVIC_BOARD_EMAILS
 *      when no list has been saved, so that env var remains the
 *      last-resort seed exactly as before.
 *   3. nothing — a resident.
 *
 * Tiers 2 and 3 are switched OFF once `officials_migrated` is set (the
 * seed script sets it after copying the legacy list onto user rows).
 * Without that switch, demoting someone in the admin panel would be
 * undone on the next request by the stale list still naming them.
 */
export async function resolveOfficial(
  email: string | undefined | null,
): Promise<OfficialIdentity | null> {
  if (!email) return null;

  const managed = await lookupOfficialByEmail(email);
  if (managed) return managed;

  if (await areOfficialsMigrated()) return null;

  const legacy = await lookupAuthor(email);
  if (legacy) {
    return toOfficialIdentity(inferOfficialType(legacy.label), legacy.label);
  }
  return null;
}

/**
 * A signed-in user's posting authority, split into its two independent
 * halves.
 *
 * `isAdmin` is a PLATFORM capability (CIVIC_ADMIN_EMAILS — reaches
 * /admin/*). `official` is a PUBLIC IDENTITY (an office an admin
 * designated). They are orthogonal: a county administrator who also sits
 * on the Board is both, and must render both badges. This function
 * therefore does NOT short-circuit on admin the way its predecessor did.
 *
 * Returns null when the user has neither — i.e. no posting privilege.
 */
export interface Authorship {
  /** Platform capability. Gates /admin/* and the "Admin" badge. */
  isAdmin: boolean;
  /** Public office, or null. Gates the title pill. */
  official: OfficialIdentity | null;
  /**
   * Permission role for the announcement edit-ownership check.
   * "admin" may edit anyone's; "author" may edit only their own.
   */
  role: "admin" | "author";
  /**
   * The string stamped on a new announcement as `author_role`. It drives
   * the feed card pill and the page eyebrow, both of which hold exactly
   * ONE value — so for someone who is both, the OFFICE wins. A post from
   * a supervisor should read as coming from the Board, not from the
   * software's administrator. The Admin badge is unaffected: it renders
   * separately, from creator_is_admin, next to the name.
   */
  label: string;
  /** Admin-curated display name for a listed author, when set. */
  name: string | null;
}

/**
 * Resolve a user's authorship for announcement posting.
 *
 * Async because both halves are DB-backed (users columns; hub_settings).
 */
export async function resolveAuthorship(
  email: string | undefined | null,
): Promise<Authorship | null> {
  if (!email) return null;

  const isAdmin = isAdminEmail(email);
  const official = await resolveOfficial(email);
  if (!isAdmin && !official) return null;

  // Legacy list may carry an admin-curated display name; the managed
  // role writes that straight to users.display_name instead, so this is
  // only consulted while the legacy tier is still live.
  const legacyName = official && !isAdmin ? (await lookupAuthor(email))?.name ?? null : null;

  return {
    isAdmin,
    official,
    role: isAdmin ? "admin" : "author",
    label: official?.title ?? "Admin",
    name: legacyName,
  };
}

/**
 * Require a valid session token. Attaches `res.locals.authUser`.
 */
/**
 * Best-effort caller identification for PUBLIC read paths. Resolves the Bearer
 * token to a user id when present, undefined otherwise. Never rejects — the
 * caller may legitimately be anonymous; a token only unlocks that caller's OWN
 * per-actor fields (has_voted, your_current_vote, is_owner, your sentiment).
 * The actor is NEVER taken from the query string (that let anyone read another
 * user's per-actor state by passing their id).
 */
export async function resolveCallerId(
  req: Request,
): Promise<string | undefined> {
  const token = extractToken(req);
  if (!token) return undefined;
  try {
    const user = await getUserFromToken(token);
    return user?.id;
  } catch {
    return undefined;
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const user = await getUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    res.locals.authUser = user;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * Require a valid session AND a user who has affirmed residency AND a
 * real name on file (required-name policy — accounts that pre-date it
 * are re-gated here; the UI catches the `name_required` code and opens
 * the add-your-name step).
 * Use this for all civic-participation actions (vote, support, submit, etc.).
 */
export async function requireResident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = res.locals.authUser as User | undefined;
    if (!user) {
      // requireAuth already responded
      return;
    }
    if (!user.is_resident) {
      res.status(403).json({
        error: "Residency affirmation required to participate",
        code: "residency_required",
      });
      return;
    }
    if (!user.full_name) {
      res.status(403).json({
        error: "Please add your name to participate",
        code: "name_required",
      });
      return;
    }
    next();
  });
}

/**
 * Require an authenticated user whose email is in CIVIC_ADMIN_EMAILS.
 * The env var is a comma-separated list; email matching is case-insensitive.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = res.locals.authUser as User | undefined;
    if (!user) return;

    const allowed = adminEmails();
    if (allowed.size === 0) {
      // Fail safely: no admins configured means nobody is admin.
      res.status(503).json({
        error:
          "Admin access is not configured. Set CIVIC_ADMIN_EMAILS on the server.",
      });
      return;
    }
    if (!allowed.has(user.email.toLowerCase())) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

/**
 * Require an authenticated user authorized to post announcements —
 * either an admin, or a user in the admin-managed author list (with
 * CIVIC_BOARD_EMAILS as an env-var fallback for the author list).
 *
 * Sets two values on res.locals for the handler to use:
 *   - `effectiveRole`: "admin" | "author"
 *   - `authorLabel`: the display label to stamp on new announcements
 *     ("Admin" for admins; the configured label otherwise)
 *
 * This is intentionally separate from requireAdmin. A user whose email
 * is on the author list can post / edit announcements but cannot reach
 * any /admin/* route.
 */
export async function requireAnnouncementPoster(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = res.locals.authUser as User | undefined;
    if (!user) return;

    const authorship = await resolveAuthorship(user.email);
    if (!authorship) {
      res.status(403).json({
        error:
          "You are not authorized to post announcements. Ask an admin to add your email.",
      });
      return;
    }

    res.locals.effectiveRole = authorship.role;
    res.locals.authorLabel = authorship.label;
    res.locals.authorOfficial = authorship.official;
    // Admin-curated display name for a listed author (null for admins, or
    // when the admin left it blank). The handler prefers this over the
    // poster's own account name so the admin controls how a board author
    // appears even before that person has set up their account.
    res.locals.authorName = authorship.name;
    next();
  });
}

/**
 * Require an authenticated user whose ACCOUNT holds the official role
 * (users.official_type / official_title, with the legacy fallback tiers
 * resolveOfficial still honours pre-migration).
 *
 * Deliberately NOT satisfied by admin status: this gates public acts of
 * an OFFICE — an official response to a Civic Brief — and "Admin" is a
 * platform capability, not an office. An administrator who also holds an
 * office passes on the office, like anyone else.
 *
 * Sets `res.locals.officialIdentity` (the {type, title} snapshot the
 * handler stamps onto whatever it writes).
 */
export async function requireOfficial(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = res.locals.authUser as User | undefined;
    if (!user) return;

    const official = await resolveOfficial(user.email);
    if (!official) {
      res.status(403).json({
        error:
          "Only accounts holding an official role can post a response. " +
          "Ask a hub admin to designate your office.",
      });
      return;
    }
    res.locals.officialIdentity = official;
    next();
  });
}

// Backward-compat alias. Old callers imported `requireBoardOrAdmin`; the
// new name is `requireAnnouncementPoster` which reflects the DB-backed,
// flexible-label semantics. Leave this re-export in place so external
// deploys that still reference the old name continue to work.
export const requireBoardOrAdmin = requireAnnouncementPoster;

/**
 * Helper: pull the authenticated user from res.locals, or throw 500.
 * Use inside controllers that are gated by requireAuth/requireResident/requireAdmin.
 */
export function getAuthUser(res: Response): User {
  const user = res.locals.authUser as User | undefined;
  if (!user) {
    throw new Error(
      "getAuthUser called on an unauthenticated route (middleware missing)",
    );
  }
  return user;
}
