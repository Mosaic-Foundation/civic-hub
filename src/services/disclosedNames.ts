// Who did something, shown exactly as the hub would (engine 2, A3; ADR-010,
// ADR-017). A package page that lists people (who is going to an event, who
// signed) asks this for their names instead of reading accounts itself. The
// answer follows the process's declared disclosure policy, as the wire does:
//   - "public":    names to every reader;
//   - "members":   names to signed-in members, nothing to the public;
//   - "anonymous": nothing below an admin;
//   - a hub admin is shown names whatever the policy.
// Names only, by the hub's one name rule (creatorDisplay.ts: full name, then
// display name, then the hub's word for a person). Never an account id or an
// address: the package passes the accounts it holds, the hub answers words.

import type { Request } from "express";
import type { Process } from "../models/process.js";
import { resolveCallerIsAdmin, resolveCallerUser } from "../middleware/auth.js";
import { disclosureOf } from "../events/publicPayload.js";
import { DISCLOSURE_POLICIES, type DisclosurePolicy } from "../processes/manifest.js";
import { getManifest } from "../processes/registry.js";
import { personFallbackName, resolveCreators } from "./creatorDisplay.js";

/** The policy a process's names are disclosed under: its own override where its type allows one. */
export function disclosurePolicyOf(process: Pick<Process, "definition" | "state">): DisclosurePolicy {
  const type = process.definition.type;
  const override = (process.state as Record<string, unknown> | undefined)?.disclosure_policy;
  if (
    typeof override === "string" &&
    getManifest(type)?.disclosureOverridable &&
    (DISCLOSURE_POLICIES as readonly string[]).includes(override)
  ) {
    return override as DisclosurePolicy;
  }
  return disclosureOf(type);
}

/** Whether a reader may see names under a policy. */
export function namesShown(policy: DisclosurePolicy, viewer: { signedIn: boolean; admin: boolean }): boolean {
  if (viewer.admin) return true;
  if (policy === "public") return true;
  if (policy === "members") return viewer.signedIn;
  return false;
}

/**
 * The names of `accounts`, in order (duplicates once), as this request's
 * reader may see them on this process; null when the policy shows this reader
 * no names (show a count instead).
 */
export async function namesFor(
  req: Request,
  process: Pick<Process, "definition" | "state">,
  accounts: readonly string[],
): Promise<string[] | null> {
  const [user, admin] = await Promise.all([resolveCallerUser(req), resolveCallerIsAdmin(req)]);
  if (!namesShown(disclosurePolicyOf(process), { signedIn: Boolean(user), admin })) return null;
  const unique = [...new Set(accounts.filter((a) => typeof a === "string" && a.length > 0))];
  const people = await resolveCreators(unique);
  return unique.map((id) => people.get(id)?.name ?? personFallbackName());
}
