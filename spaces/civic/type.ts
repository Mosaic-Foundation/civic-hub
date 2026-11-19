// The Civic Hub space type's record (console slice, 2026-11-10; kernel step 4):
// what a space of this type is called, how its mail reads, and its profile.
// The deployment picks the space type in config/plugins.json ("space");
// `npm run plugins:sync` names this record in config/spaceType.ts, which
// src/shared/spaceTypes.ts alone reads.
//
// Shared by the server and the UI. Pure data.

import type { SpaceType } from "../../src/shared/spaceTypes.js";
import { CIVIC_PROFILE } from "./profile.js";

export const CIVIC_HUB: SpaceType = {
  id: "civic_hub",
  displayName: "Civic Hub",
  noun: CIVIC_PROFILE.space.one,
  nounPlural: CIVIC_PROFILE.space.many,
  domainPattern: "*.civic.social",
  memberSender: { setting: "RESEND_FROM", domain: "civic.social" },
  supportAddress: "contact@civic.social",
  // mosaic.social once Adam has verified it with the provider; until then the
  // console's codes come from the member sender, as before (2026-11-10).
  operatorSender: { setting: "CIVIC_OPERATOR_MAIL_FROM", domain: "civic.social" },
  maintainer: "Civic.Social",
  templateSet: "civic-hub",
  profile: CIVIC_PROFILE,
};

export default CIVIC_HUB;
