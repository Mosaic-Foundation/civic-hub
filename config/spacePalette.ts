// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// The deployment's space type (config/plugins.json's "space"): its palette. Read only by src/shared/spacePalette.ts. Plain data, because the UI reads it too.

import type { SpacePalette } from "../src/shared/spacePalette.js";
import palette from "../spaces/civic/palette.js";

export const PALETTE: SpacePalette | null = palette;
