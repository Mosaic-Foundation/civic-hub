// The plugin conformance suite against this hub's own process types: every
// registered type, walked through what its descriptor says applies
// (tests/conformance/runConformance.ts). Registering a type is enough to have
// it tested here. Runs in both CI passes (service role, minted hub tokens).
//
// LOCAL STACK ONLY (it writes draft rows, moves deadlines and adds a trigger
// on its own rows). Needs a server started with CIVIC_POLIS_FAKE=on
// (CIVIC_API_BASE).

import { getAllHandlers } from "../../src/processes/registry.js";
import { runConformance } from "../conformance/runConformance.js";

runConformance({ handlers: getAllHandlers() });
