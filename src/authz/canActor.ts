// canActor(actor, action, resource): the one place a hub decides whether a
// person may do something (ADR-011; authorization-model-note "A single
// authorization seam").
//
// Every route, controller and service that used to compare an email with a
// roster, or read a role flag, asks here instead. The rules are today's, moved
// and not changed: the API suite, Playwright and tests/api/authzParity.test.ts
// (old rules against new, on every role, action and type) hold them equal.
//
// ADDING A CHECK: name the question as an action below, answer it in
// `decide`, and call canActor (or assertCan) where the question arises. Do not
// read actor.roles, compare an email, or test a role anywhere else: eslint's
// civic/authz-seam rule refuses role checks outside src/authz/.
//
// The decision reads only the actor's claims (src/authz/actor.ts) and the
// resource. It never reads an email address.

import { CivicError, ForbiddenError, UnauthorizedError, UnavailableError } from "../errors/index.js";
import type { Process } from "../models/process.js";
import type { ActionCaller } from "../processes/types.js";
import type { OfficialIdentity } from "../shared/officialTypes.js";
import { inferOfficialType, toOfficialIdentity } from "../shared/officialTypes.js";
import { getHubRoles } from "../db/hubRolesStore.js";
import { currentHubIdOrNull } from "../config/hubContext.js";
import { areOfficialsMigrated } from "../services/hubSettings.js";
import { lookupOfficialBySubject } from "../services/officials.js";
import { holds, type Actor, type AccountActor } from "./actor.js";
import { declaredRuleRefusal, hubRuleRefusal } from "./eligibility.js";

/**
 * The questions a hub asks. Hub-wide ones take no resource; process ones take
 * the process (and, for an action, its name).
 */
export type HubAction =
  /** Take part: vote, support, comment, submit, draft (the hub's eligibility rule). */
  | "hub.participate"
  /** Act as one of the hub's administrators (settings, queues, moderation, admin routes). */
  | "hub.administer"
  /** Be shown what an administrator is shown on a public read (unpublished records, account ids, the admin view of the wire). */
  | "hub.see_as_admin"
  /** Post or edit announcements (an administrator, or an account holding a public office). */
  | "announcement.post"
  /** Speak for a public office (an official response to a brief). Administrators as such may not. */
  | "office.respond";

export type ProcessQuestion =
  /** Call one of a process's actions. */
  | "process.act"
  /** Find a process that is not public (pending review, archived): the 404 otherwise. */
  | "process.see_unpublished";

/** Who a permitted announcement poster is, for the byline. */
export interface Authorship {
  /** Platform capability. Gates /admin/* and the "Admin" badge. */
  isAdmin: boolean;
  /** Public office, or null. Gates the title pill. */
  official: OfficialIdentity | null;
  /** "admin" may edit anyone's announcements; "author" only their own. */
  role: "admin" | "author";
  /** The one label a post carries: the office for someone who is both. */
  label: string;
  /** Admin-curated display name for a listed author, when set. */
  name: string | null;
}

export type Decision =
  | { allowed: true; caller?: ActionCaller; authorship?: Authorship; official?: OfficialIdentity }
  | { allowed: false; error: CivicError };

const ALLOW: Decision = { allowed: true };
const refuse = (error: CivicError): Decision => ({ allowed: false, error });

const signInRequired = () => new UnauthorizedError("Authentication required", "sign_in_required");
const codeRequired = () =>
  new ForbiddenError("Sign in with a code sent to your email to do this.", "code_sign_in_required");

export async function canActor(actor: Actor, action: HubAction): Promise<Decision>;
export async function canActor(
  actor: Actor,
  action: ProcessQuestion,
  resource: { process: Process; action?: string },
): Promise<Decision>;
export async function canActor(
  actor: Actor,
  action: HubAction | ProcessQuestion,
  resource?: { process: Process; action?: string },
): Promise<Decision> {
  switch (action) {
    case "hub.participate": {
      if (actor.kind !== "account") return refuse(signInRequired());
      const no = hubRuleRefusal(actor);
      return no ? refuse(no) : ALLOW;
    }

    case "hub.administer": {
      if (actor.kind !== "account") return refuse(signInRequired());
      if (actor.assurance !== "code") return refuse(codeRequired());
      // Fails closed on an empty roster, and says how to recover: a hub in
      // this state has nobody who can add an administrator, which is why the
      // roster endpoint refuses to empty it. A pending grant counts: the hub
      // has an administrator, who has not signed in yet.
      const hubId = currentHubIdOrNull();
      if (!hubId || (await getHubRoles(hubId)).granted.admin === 0) {
        return refuse(
          new UnavailableError(
            "This hub has no administrators. The platform operator sets them from the console (the hub's handover panel).",
            "no_admins",
          ),
        );
      }
      return holds(actor, "admin") ? ALLOW : refuse(new ForbiddenError("Admin access required", "admin_required"));
    }

    case "hub.see_as_admin":
      return holds(actor, "admin") ? ALLOW : refuse(new ForbiddenError("Admin access required", "admin_required"));

    case "announcement.post": {
      if (actor.kind !== "account") return refuse(signInRequired());
      if (actor.assurance !== "code") return refuse(codeRequired());
      const authorship = await authorshipOf(actor);
      return authorship
        ? { allowed: true, authorship }
        : refuse(
            new ForbiddenError(
              "You are not authorized to post announcements. Ask an admin to add your email.",
              "author_required",
            ),
          );
    }

    case "office.respond": {
      if (actor.kind !== "account") return refuse(signInRequired());
      if (actor.assurance !== "code") return refuse(codeRequired());
      // Deliberately not satisfied by admin: this is an act of an office.
      const official = await officialOf(actor);
      return official
        ? { allowed: true, official }
        : refuse(
            new ForbiddenError(
              "Only accounts holding an official role can post a response. Ask a hub admin to designate your office.",
              "official_required",
            ),
          );
    }

    case "process.see_unpublished":
      return holds(actor, "admin") ? ALLOW : refuse(new ForbiddenError("Admin access required", "admin_required"));

    case "process.act": {
      // The hub's rule, which every process inherits, then the caller: an
      // administrator acts as "admin"; anyone else as "resident", held to the
      // type's declared requirements and, in executeAction, to the actions
      // its descriptor opens to residents (callerRefusal below).
      if (actor.kind !== "account") return refuse(signInRequired());
      const no = hubRuleRefusal(actor);
      if (no) return refuse(no);
      if (holds(actor, "admin")) return { allowed: true, caller: "admin" };
      const stricter = declaredRuleRefusal(actor, resource!.process.definition.type);
      return stricter ? refuse(stricter) : { allowed: true, caller: "resident" };
    }
  }
}

/** canActor, throwing the refusal. Returns the decision for what it carries. */
export async function assertCan(actor: Actor, action: HubAction): Promise<Extract<Decision, { allowed: true }>>;
export async function assertCan(
  actor: Actor,
  action: ProcessQuestion,
  resource: { process: Process; action?: string },
): Promise<Extract<Decision, { allowed: true }>>;
export async function assertCan(
  actor: Actor,
  action: HubAction | ProcessQuestion,
  resource?: { process: Process; action?: string },
): Promise<Extract<Decision, { allowed: true }>> {
  const d = await canActor(actor, action as ProcessQuestion, resource as { process: Process });
  if (!d.allowed) throw d.error;
  return d;
}

/** canActor as a yes or no, for a read that shows more to some callers. */
export async function can(actor: Actor, action: HubAction): Promise<boolean> {
  return (await canActor(actor, action)).allowed;
}

/**
 * What the descriptor allows this caller (executeAction, before the status is
 * read, so a refused caller learns nothing about where the process is): a
 * resident may call only what it opens to residents, or to the creator when
 * they are the creator; everything else is an administrator's or the hub's.
 */
export function callerMayCall(
  caller: ActionCaller,
  declared: { callers: readonly string[] } | undefined,
  process: Process,
  subject: string,
  official = false,
): boolean {
  if (caller !== "resident") return true;
  if (!declared) return false;
  if (declared.callers.includes("resident")) return true;
  // An action open to officials (engine 2, A6): a resident holding a public
  // office, as subjectIsOfficial answers, before the call.
  if (official && declared.callers.includes("official")) return true;
  return declared.callers.includes("creator") && subject !== "" && subject === process.createdBy;
}

/**
 * Whether an account holds a public office: users.official_type and
 * official_title, set by an admin (engine 2, A6). The managed role only, not
 * the legacy author list, which authorizes announcements and nothing else.
 * Asked for the descriptor's `official` caller and for a type whose officials
 * publish at once.
 */
export async function subjectIsOfficial(subject: string | null | undefined): Promise<boolean> {
  if (!subject) return false;
  return (await lookupOfficialBySubject(subject)) !== null;
}

/**
 * Whether a creator's submission skips the review wait: an administrator's
 * always (canActor "hub.administer"), and an official's where the type's
 * descriptor names officials in `creation.resident.publish_at_once` (Events).
 */
export async function publishesAtOnce(
  actor: Actor,
  creation: { publish_at_once?: readonly string[] } | null | undefined,
): Promise<{ admin: boolean; official: boolean }> {
  const admin = (await canActor(actor, "hub.administer")).allowed;
  if (admin || actor.kind !== "account" || !creation?.publish_at_once?.includes("official")) return { admin, official: false };
  return { admin, official: await subjectIsOfficial(actor.subject) };
}

/**
 * Who may edit a live process through the hub's edit path (engine 2, A1): its
 * creator; and a hub admin where the type's edit policy says admins edit too
 * (Events: creators and admins edit everything, Adam, 2026-10-27). Every
 * other type stays creator-only (Adam, 2026-09-03).
 */
export async function mayEdit(actor: Actor, process: Process, adminsEdit: boolean): Promise<boolean> {
  if (actor.kind !== "account") return false;
  if (actor.subject === process.createdBy) return true;
  return adminsEdit && (await canActor(actor, "hub.administer")).allowed;
}

// --- offices and authorship ---------------------------------------------------

/**
 * An account's public office, most authoritative first:
 *   1. users.official_type / official_title — the managed role, by account;
 *   2. the legacy announcement-author list (an announcement_author grant:
 *      its label becomes the title, its type inferred), until the hub's
 *      officials_migrated latch is set;
 *   3. none.
 * The three are read in parallel; precedence is applied after.
 */
async function officialParts(
  actor: AccountActor,
): Promise<{ official: OfficialIdentity | null; legacyName: string | null }> {
  const [managed, migrated] = await Promise.all([
    lookupOfficialBySubject(actor.subject),
    areOfficialsMigrated(currentHubIdOrNull()),
  ]);
  if (managed) return { official: managed, legacyName: null };
  const legacy = actor.roles.get("announcement_author");
  if (migrated || !legacy?.label) return { official: null, legacyName: null };
  return {
    official: toOfficialIdentity(inferOfficialType(legacy.label), legacy.label),
    legacyName: legacy.name ?? null,
  };
}

/** The account's public office, or null. */
export async function officialOf(actor: Actor): Promise<OfficialIdentity | null> {
  if (actor.kind !== "account") return null;
  return (await officialParts(actor)).official;
}

/**
 * Whether, and as whom, an account may post announcements: an administrator
 * (the platform capability) and/or an office (a public identity). Both halves
 * independently: someone who is both renders both badges. Null: neither.
 */
export async function authorshipOf(actor: Actor): Promise<Authorship | null> {
  if (actor.kind !== "account") return null;
  // The role itself, whatever the session: /auth/me shows it, and a session
  // that may not carry it never reaches here holding it (see holds()).
  const isAdmin = actor.roles.has("admin");
  const { official, legacyName } = await officialParts(actor);
  if (!isAdmin && !official) return null;
  return {
    isAdmin,
    official,
    role: isAdmin ? "admin" : "author",
    label: official?.title ?? "Admin",
    name: official && !isAdmin ? legacyName : null,
  };
}
