// Auth middleware: who is asking (the session), and whether they may (the seam).
//
// Five guards, each a question put to the one authorization seam
// (src/authz/, canActor; ADR-011):
//   requireAuth                — a valid session token
//   requireResident            — "hub.participate": the hub's eligibility rule
//   requireAdmin               — "hub.administer"
//   requireAnnouncementPoster  — "announcement.post"
//   requireOfficial            — "office.respond"
//
// sessionUser() below is the identity adapter: the one place a request's
// token becomes a user (res.locals.authUser) and an actor (res.locals.actor).
// A different sign-in method (a DID, a partner's identity provider) plugs in
// there and nowhere else. Controllers read the actor from res.locals, NOT from
// request bodies. This closes the hole where any caller could POST
// { actor: "<anyone>" } and act as that user.

import { Request, Response } from "express";
import { UnauthorizedError } from "../errors/index.js";
import { route } from "../http/route.js";
import {
  getSessionFromToken,
  getUserFromToken,
  type SessionAssurance,
  type User,
} from "../modules/civic.auth/index.js";
import { actorFor, SIGNED_OUT, type Actor } from "../authz/actor.js";
import { assertCan, can } from "../authz/canActor.js";

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

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
  return (await resolveCallerUser(req))?.id;
}

/**
 * Full-user variant of resolveCallerId, for public read paths that need the
 * caller's AUDIENCE as well as their id (public anonymity, 2026-08-31): a
 * valid session means audience 'member' (real names, today's behavior); no
 * or invalid token means audience 'public' (resident identities redacted).
 * Never rejects and never gates the route — it only informs the response.
 */
export async function resolveCallerUser(
  req: Request,
): Promise<User | undefined> {
  const token = extractToken(req);
  if (!token) return undefined;
  try {
    return (await getUserFromToken(token)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The caller as the authorization seam sees them, for a PUBLIC read path:
 * the account behind a valid token, or SIGNED_OUT. Never rejects and never
 * gates the route; the route asks canActor what to show.
 */
export async function resolveCallerActor(req: Request): Promise<Actor> {
  const token = extractToken(req);
  if (!token) return SIGNED_OUT;
  try {
    const session = await getSessionFromToken(token);
    return session ? await actorFor(session.user, session.assurance) : SIGNED_OUT;
  } catch {
    return SIGNED_OUT;
  }
}

/**
 * resolveCallerUser and resolveCallerActor from one session lookup, for a
 * public read that needs the caller's id and asks the seam what to show.
 */
export async function resolveCaller(req: Request): Promise<{ user: User | undefined; actor: Actor }> {
  const token = extractToken(req);
  if (!token) return { user: undefined, actor: SIGNED_OUT };
  try {
    const session = await getSessionFromToken(token);
    if (!session) return { user: undefined, actor: SIGNED_OUT };
    return { user: session.user, actor: await actorFor(session.user, session.assurance) };
  } catch {
    return { user: undefined, actor: SIGNED_OUT };
  }
}

/**
 * Whether the caller may be shown what an administrator is shown, for a
 * public route that shows an admin more ("hub.see_as_admin"). Never rejects
 * and never gates the route.
 */
export async function resolveCallerIsAdmin(req: Request): Promise<boolean> {
  return can(await resolveCallerActor(req), "hub.see_as_admin");
}

/**
 * The identity adapter: the signed-in user, from the session token, or
 * UnauthorizedError. Stores the user, the session's assurance and the actor
 * on res.locals for the handler. The one place a sign-in method plugs in.
 */
async function sessionUser(req: Request, res: Response): Promise<{ user: User; actor: Actor }> {
  const token = extractToken(req);
  if (!token) throw new UnauthorizedError("Authentication required", "sign_in_required");
  const session = await getSessionFromToken(token);
  if (!session) throw new UnauthorizedError("Invalid or expired session", "session_expired");
  const actor = await actorFor(session.user, session.assurance);
  res.locals.authUser = session.user;
  res.locals.authAssurance = session.assurance;
  res.locals.actor = actor;
  return { user: session.user, actor };
}

/** Require a valid session token. Attaches `res.locals.authUser` and `res.locals.actor`. */
export const requireAuth = route(async (req, res, next) => {
  await sessionUser(req, res);
  next();
});

/**
 * Require a session whose account meets the hub's eligibility rule
 * ("hub.participate": residency affirmed, a real name on file; accounts
 * that pre-date the name rule are re-gated here, and the UI catches the
 * `name_required` code and opens the add-your-name step).
 * Use this for all civic-participation actions (vote, support, submit, etc.).
 */
export const requireResident = route(async (req, res, next) => {
  const { actor } = await sessionUser(req, res);
  await assertCan(actor, "hub.participate");
  next();
});

/**
 * Require one of this hub's administrators ("hub.administer"): a session
 * proved by an emailed code, an account holding the admin role; a hub with
 * no administrators at all fails closed (no_admins).
 */
export const requireAdmin = route(async (req, res, next) => {
  const { actor } = await sessionUser(req, res);
  await assertCan(actor, "hub.administer");
  next();
});

/**
 * Require an account that may post announcements ("announcement.post"): an
 * administrator, or an account holding a public office (the managed role,
 * or a legacy author-list grant until the hub's officials are migrated).
 *
 * Sets on res.locals for the handler:
 *   - `effectiveRole`: "admin" | "author"
 *   - `authorLabel`: the display label to stamp on new announcements
 *     ("Admin" for admins; the office otherwise)
 *   - `authorOfficial`, `authorName`
 *
 * This is intentionally separate from requireAdmin. An author can post and
 * edit announcements but cannot reach any /admin/* route.
 */
export const requireAnnouncementPoster = route(async (req, res, next) => {
  const { actor } = await sessionUser(req, res);
  const { authorship } = await assertCan(actor, "announcement.post");

  res.locals.effectiveRole = authorship!.role;
  res.locals.authorLabel = authorship!.label;
  res.locals.authorOfficial = authorship!.official;
  // Admin-curated display name for a listed author (null for admins, or
  // when the admin left it blank). The handler prefers this over the
  // poster's own account name so the admin controls how a board author
  // appears even before that person has set up their account.
  res.locals.authorName = authorship!.name;
  next();
});

/**
 * Require an account holding a public office ("office.respond"). Deliberately
 * NOT satisfied by admin status: this gates public acts of an OFFICE — an
 * official response to a Civic Brief — and "Admin" is a platform capability,
 * not an office. An administrator who also holds an office passes on the
 * office, like anyone else.
 *
 * Sets `res.locals.officialIdentity` (the {type, title} snapshot the
 * handler stamps onto whatever it writes).
 */
export const requireOfficial = route(async (req, res, next) => {
  const { actor } = await sessionUser(req, res);
  const { official } = await assertCan(actor, "office.respond");
  res.locals.officialIdentity = official;
  next();
});

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

/**
 * The actor the guard resolved, for a controller to put to canActor. Throws
 * (500) on a route no guard ran on, like getAuthUser.
 */
export function getActor(res: Response): Actor {
  const actor = res.locals.actor as Actor | undefined;
  if (!actor) {
    throw new Error("getActor called on an unauthenticated route (middleware missing)");
  }
  return actor;
}

export type { SessionAssurance };
