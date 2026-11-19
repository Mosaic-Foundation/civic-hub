// The palette of the hub's space type (config/space.ts): its colour families,
// card kinds and digest sections. The hosting layer chooses it with the space
// type; the kernel reads this file in one place (src/shared/spacePalette.ts).
// Plain data, because the UI reads it too. A deployment with no space type
// exports null.

import type { SpacePalette } from "../src/shared/spacePalette.js";
import { civicPalette } from "../spaces/civic/palette.js";

export const PALETTE: SpacePalette | null = civicPalette;
