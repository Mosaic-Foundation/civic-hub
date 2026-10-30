// What a create form's place choice does when the hub's kind changes. Beside
// JurisdictionPicker, which draws the choice.

import type { HubKind } from "../../../src/shared/hubKind";

/** Does this change of kind go to or from a place hub? Then the place chosen so far no longer applies. */
export function crossesPlace(from: HubKind, to: HubKind): boolean {
  return (from === "place") !== (to === "place");
}
