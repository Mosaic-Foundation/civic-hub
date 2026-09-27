// The three names sample content is filled with (Phase 7), for the hub in
// scope. Read when the content is seeded, and when the mock conversation
// serves its statements, so both say the same thing.
//
// {JURISDICTION} is the place without its state ("Example County" from
// "Example County, Virginia"), the way it reads mid-sentence; the hub's name
// when no jurisdiction is set. {GOVERNING_BODY} falls back to "local
// government", which reads right after "the" in every template — for a place
// hub, the only kind any template is written for today. A hub of another
// kind (identity.hub_kind) gets no templates; should one ever be filled for
// it, both names read as the hub's own ("the <hub> organizers"), never as a
// government it does not have.

import { currentHub } from "../config/hubContext.js";
import { KEYS } from "../models/hubSettings.js";
import { hubKindOf } from "../shared/hubKind.js";
import { getSettingSync, hubDisplayNameSync } from "./hubSettings.js";
import type { SampleNames } from "./sampleTemplates.js";

export function sampleNames(): SampleNames {
  const hubName = hubDisplayNameSync();
  const jurisdiction = currentHub()?.jurisdiction_name?.split(",")[0]?.trim();
  const governingBody = getSettingSync(KEYS.COPY_GOVERNING_BODY_NAME)?.trim();
  if (hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)) !== "place") {
    return { HUB_NAME: hubName, JURISDICTION: jurisdiction || hubName, GOVERNING_BODY: `${hubName} organizers` };
  }
  return {
    HUB_NAME: hubName,
    JURISDICTION: jurisdiction || hubName,
    GOVERNING_BODY: governingBody || "local government",
  };
}
