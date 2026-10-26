// The suite against the package under test (CIVIC_CONFORMANCE_TYPES, its
// process type), on the test host `civic-conformance` started
// (CIVIC_API_BASE), on the two hubs it made (CIVIC_CONFORMANCE_BETA, _DEMO).

import { getAllHandlers } from "@civic-social/plugin-sdk/testing";
import { runConformance } from "./runConformance.js";

const only = (process.env.CIVIC_CONFORMANCE_TYPES ?? "").split(",").map((t) => t.trim()).filter(Boolean);
if (only.length === 0) throw new Error("CIVIC_CONFORMANCE_TYPES names no type: run the suite through `civic-conformance <package dir>`.");
const handlers = getAllHandlers().filter((h) => only.includes(h.type));
if (handlers.length !== only.length) throw new Error(`the test host does not load ${only.join(", ")}`);

runConformance({ handlers });
