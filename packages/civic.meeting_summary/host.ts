// The host the hub gave this package when it loaded it (./index.ts binds it):
// the adapters its job summarizes and reads recordings through.

import { storeSlot, type PluginHost } from "../../src/sdk/index.js";

export const meetingSummaryHost = storeSlot<PluginHost>("civic.meeting_summary host");
