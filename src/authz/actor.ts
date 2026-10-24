// The actor: who is asking, as the authorization seam sees them (ADR-011).
//
// An actor is a SUBJECT (the account id, users.id) and the claims the hub
// holds about it: its hub roles (hub_roles, by account), whether it affirmed
// residency, whether a real name is on file, and how its session was proved.
// Never an email address: a check that needs to know who someone is asks by
// subject, so a person who signed in another way (a DID, a partner's identity
// provider) is the same actor to every rule.
//
// Built once per request from the session (src/middleware/auth.ts, the one
// place the identity adapter turns a token into a user) or from a bearer token
// on a public read. Plugins never receive it: a handler gets the subject as an
// opaque participant reference (action.actor) and asks the seam yes/no
// questions, never for the roles or the claims themselves (plugin spec §5).

import type { SessionAssurance, User } from "../modules/civic.auth/index.js";
import { getHubRoles, type HubRole, type RoleAttrs } from "../db/hubRolesStore.js";
import { currentHubIdOrNull } from "../config/hubContext.js";

export type { HubRole, RoleAttrs };

/** Nobody signed in (no token, or one that resolves to no session). */
export interface SignedOutActor {
  readonly kind: "signed_out";
}

/** A signed-in account on this hub. */
export interface AccountActor {
  readonly kind: "account";
  /** The account id: the only identifier a rule reads. */
  readonly subject: string;
  /** How the session was proved. A demo session ("demo") carries no role. */
  readonly assurance: SessionAssurance;
  /** The hub roles granted to this account, with what each carries. */
  readonly roles: ReadonlyMap<HubRole, RoleAttrs>;
  /** Affirmed residency (self-attested today; a credential later). */
  readonly resident: boolean;
  /** A real name is on file (the hub's real-name rule, eligibility.ts). */
  readonly named: boolean;
}

export type Actor = SignedOutActor | AccountActor;

export const SIGNED_OUT: SignedOutActor = Object.freeze({ kind: "signed_out" });

const NO_ROLES: ReadonlyMap<HubRole, RoleAttrs> = new Map();

/**
 * The actor for a session's account on the hub serving this request. Roles
 * come from the hub's cached grants (src/db/hubRolesStore.ts); outside a hub
 * there are none, as there are no sessions.
 */
export async function actorFor(user: User, assurance: SessionAssurance): Promise<AccountActor> {
  const hubId = currentHubIdOrNull();
  const roles = hubId ? (await getHubRoles(hubId)).byUser.get(user.id) ?? NO_ROLES : NO_ROLES;
  return {
    kind: "account",
    subject: user.id,
    assurance,
    roles,
    resident: user.is_resident,
    named: !!user.full_name,
  };
}

/**
 * Does this actor hold the role with a session that may carry it? Every hub
 * role needs a session proved by an emailed code (Audit 2: a demo hub's
 * any-six-digits session never carries a privilege). Such a session cannot
 * exist for a role holder today (civic.auth refuses it at lookup), so this is
 * the same rule stated where the rules live.
 */
export function holds(actor: Actor, role: HubRole): boolean {
  return actor.kind === "account" && actor.assurance === "code" && actor.roles.has(role);
}

/** Whether an account holds a role, by subject: for showing a badge beside someone else's name. */
export async function subjectHolds(subject: string | null | undefined, role: HubRole): Promise<boolean> {
  const hubId = currentHubIdOrNull();
  if (!subject || !hubId) return false;
  return (await getHubRoles(hubId)).byUser.get(subject)?.has(role) ?? false;
}

/** The accounts among `subjects` that hold a role, in one cached read: for a list of bylines. */
export async function subjectsHolding(subjects: Iterable<string>, role: HubRole): Promise<ReadonlySet<string>> {
  const hubId = currentHubIdOrNull();
  const out = new Set<string>();
  if (!hubId) return out;
  const roles = (await getHubRoles(hubId)).byUser;
  for (const s of subjects) if (roles.get(s)?.has(role)) out.add(s);
  return out;
}
