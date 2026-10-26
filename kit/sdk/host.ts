// @civic-social/plugin-sdk/host: where the hub's engine is, for the test host
// the conformance suite starts (@civic-social/plugin-conformance). In this
// repository it is the repository; in the npm package, the engine copied
// beside this file (./scripts/pack.ts rewrites the path).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The engine's root: its src/, config/, packages/, supabase/ and scripts/. */
export const HOST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
