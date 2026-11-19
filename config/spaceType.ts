// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// The deployment's space type (config/plugins.json's "space"): its record (names, mail, profile). Read only by src/shared/spaceTypes.ts.

import type { SpaceType } from "../src/shared/spaceTypes.js";
import type_ from "../spaces/civic/type.js";

export const SPACE_TYPE: SpaceType | null = type_;
