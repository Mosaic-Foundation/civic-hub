// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// The deployment's space type (config/plugins.json's "space"): its server part. The kernel reads it in one place, src/plugins/spaceType.ts.

import type { SpaceServer } from "../src/plugins/space.js";
import space from "../spaces/civic/index.js";

export const SPACE: SpaceServer | null = space;
