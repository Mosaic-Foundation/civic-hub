// The plugin conformance suite against this hub's own process types: every
// registered type, walked through what its descriptor says applies
// (kit/conformance/src/runConformance.ts). Registering a type is enough to have
// it tested here. Runs in both CI passes (service role, minted hub tokens).
//
// CIVIC_CONFORMANCE_TYPES (a comma list of process types) walks only those:
// `npm run catalog:add` uses it to prove one package before writing its
// catalog entry (ADR-014).
//
// LOCAL STACK ONLY (it writes draft rows, moves deadlines and adds a trigger
// on its own rows). Needs a server started with CIVIC_POLIS_FAKE=on
// (CIVIC_API_BASE).

import { getAllHandlers } from "../../src/processes/registry.js";
import { runConformance } from "../../kit/conformance/src/runConformance.js";

const only = (process.env.CIVIC_CONFORMANCE_TYPES ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const handlers = getAllHandlers().filter((h) => only.length === 0 || only.includes(h.type));
if (only.length > 0 && handlers.length !== only.length) {
  throw new Error(`CIVIC_CONFORMANCE_TYPES names a type this hub does not load: ${only.join(", ")}`);
}

runConformance({ handlers });
