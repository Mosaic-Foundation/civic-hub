// The hub's space type, as the hosting layer chose it (config/space.ts). The
// one file of the kernel that reads that choice (eslint `civic/package-boundary`).

import type { SpaceServer } from "./space.js";
import { SPACE } from "../../config/space.js";

/** The deployment's space type, or null (its hubs start empty). */
export function spaceType(): SpaceServer | null {
  return SPACE;
}
