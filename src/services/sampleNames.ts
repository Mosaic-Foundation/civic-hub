// The three names sample content is filled with (Phase 7), for the hub in
// scope. Read when the content is seeded, and when the mock conversation
// serves its statements, so both say the same thing.
//
// {JURISDICTION} is the place without its state ("Example County" from
// "Example County, Virginia"), the way it reads mid-sentence; the hub's name
// when no jurisdiction is set. {GOVERNING_BODY} falls back to "local
// government", which reads right after "the" in every template.

import { currentHub } from "../config/hubContext.js";
import { KEYS } from "../models/hubSettings.js";
import { getSettingSync, hubDisplayNameSync } from "./hubSettings.js";
import type { SampleNames } from "./sampleTemplates.js";

export function sampleNames(): SampleNames {
  const hubName = hubDisplayNameSync();
  const jurisdiction = currentHub()?.jurisdiction_name?.split(",")[0]?.trim();
  const governingBody = getSettingSync(KEYS.COPY_GOVERNING_BODY_NAME)?.trim();
  return {
    HUB_NAME: hubName,
    JURISDICTION: jurisdiction || hubName,
    GOVERNING_BODY: governingBody || "local government",
  };
}
