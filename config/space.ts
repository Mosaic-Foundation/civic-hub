// The hub's space type (kernel step 3; docs/kernel/SURFACE.md, "Space types"):
// the layer above the kernel that makes this deployment a Civic Hub. The
// hosting layer chooses it here; the kernel reads this file in one place
// (src/plugins/spaceType.ts) and never names a space type itself. A
// deployment with no space type exports null: its hubs start empty and its
// development seed seeds nothing.

import type { SpaceServer } from "../src/plugins/space.js";
import civicHub from "../spaces/civic/index.js";

export const SPACE: SpaceServer | null = civicHub;
