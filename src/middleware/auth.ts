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
import { lookupAuthor } from "../services/hubSettings.js";

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
 * Resolve a user's effective role for announcement posting.
 *
 * Returns:
 *   - { role: "admin", label: "Admin" } when the user is in
 *     CIVIC_ADMIN_EMAILS. Admins always post as "Admin" regardless of
 *     whether their email also appears in the author list.
 *   - { role: "author", label: <configured label> } when the user's email
 *     is in the admin-managed author list (hub_settings), falling back to
 *     CIVIC_BOARD_EMAILS with a default label of "Board member".
 *   - null when the user has no posting privilege.
 *
 * Async because the author list lives in hub_settings (Postgres).
 */
export async function resolveAuthorship(
  email: string | undefined | null,
): Promise<{
  role: "admin" | "author";
  label: string;
  /** Admin-curated display name for a listed author, when set. null for
   *  admins (who post under their own account name). */
  name: string | null;
} | null> {
  if (!email) return null;
  if (isAdminEmail(email)) return { role: "admin", label: "Admin", name: null };
  const author = await lookupAuthor(email);
  if (author) return { role: "author", label: author.label, name: author.name ?? null };
  return null;
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
    // Admin-curated display name for a listed author (null for admins, or
    // when the admin left it blank). The handler prefers this over the
    // poster's own account name so the admin controls how a board author
    // appears even before that person has set up their account.
    res.locals.authorName = authorship.name;
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
