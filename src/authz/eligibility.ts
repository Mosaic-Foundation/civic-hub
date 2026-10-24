// Who may take part: the hub's rule, and what a process type may add to it
// (ADR-011; Adam, items 3 and 4 and Q7 of Architecture 4).
//
// THE HUB'S RULE, inherited by every process:
//   residency  the person affirmed they live in the hub's jurisdiction (on
//              this hub; self-attested today, a credential later);
//   real name  a real name is on file. Pseudonymous participation is
//              deliberately not offered yet. Turning it on needs three things
//              together: this constant made a hub setting, the `pseudonymous`
//              disclosure value (identity spec §8.2) on the types that allow
//              it, and the UI showing a pseudonym where a name is shown today.
//
// A TYPE MAY BE STRICTER: its manifest's `eligibility.requirements` names
// credential types (process spec §12.1), read with the identity spec's §8.1
// conjunction. The descriptor serves them. No type declares any, and no
// credential can be presented yet (credentialsOf is the seam the identity
// layer will fill), so today the hub's rule is the whole rule.

import { ForbiddenError, type CivicError } from "../errors/index.js";
import { MANIFEST_LIST } from "../shared/processManifests.js";
import type { AccountActor } from "./actor.js";

/** The hub's participation rule. A constant (Q7): no hub can change it yet. */
export const HUB_ELIGIBILITY = Object.freeze({
  residency: "hub" as const,
  realName: "required" as const,
});

/** A type's declared requirements, or undefined: it inherits the hub's rule. */
export type EligibilityRequirements = readonly (string | readonly string[])[];

export function declaredEligibility(processType: string): EligibilityRequirements | undefined {
  return MANIFEST_LIST.find((m) => m.descriptor.type === processType)?.eligibility?.requirements;
}

/**
 * The credential types an actor has presented and the hub has verified. None
 * today: the identity layer's credential verification plugs in here.
 */
export function credentialsOf(_actor: AccountActor): ReadonlySet<string> {
  return new Set();
}

/** §8.1: every entry must be met; an entry that is a list is met by any one of its members. */
export function satisfies(held: ReadonlySet<string>, requirements: EligibilityRequirements): boolean {
  return requirements.every((r) => (typeof r === "string" ? held.has(r) : r.some((alt) => held.has(alt))));
}

/** The hub's rule: why this account may not take part, or null. Residency is asked first, as it always was. */
export function hubRuleRefusal(actor: AccountActor): CivicError | null {
  if (!actor.resident) {
    return new ForbiddenError("Residency affirmation required to participate", "residency_required");
  }
  if (HUB_ELIGIBILITY.realName === "required" && !actor.named) {
    return new ForbiddenError("Please add your name to participate", "name_required");
  }
  return null;
}

/** A type's stricter rule: why this account may not take part in one of its processes, or null. */
export function declaredRuleRefusal(actor: AccountActor, processType: string): CivicError | null {
  const requirements = declaredEligibility(processType);
  if (!requirements || satisfies(credentialsOf(actor), requirements)) return null;
  return new ForbiddenError("Taking part here needs a credential this hub can't check yet.", "eligibility_required");
}
