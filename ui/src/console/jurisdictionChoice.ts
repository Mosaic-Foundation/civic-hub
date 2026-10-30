// What a create form's place choice does when the hub's kind changes. Beside
// JurisdictionPicker, which draws the choice.

import type { HubKind } from "../../../src/shared/hubKind";
import type { JurisdictionChoice } from "./JurisdictionPicker";

/** Does this change of kind go to or from a place hub? Then the place chosen so far no longer applies. */
export function crossesPlace(from: HubKind, to: HubKind): boolean {
  return (from === "place") !== (to === "place");
}

/** What the choice becomes when the kind changes; the same object when it still stands. */
export function choiceAfterKind(from: HubKind, to: HubKind, choice: JurisdictionChoice): JurisdictionChoice {
  if (crossesPlace(from, to)) return { kind: "unlinked" };
  return choice.kind === "custom" && to !== "community" ? { kind: "unlinked" } : choice;
}
