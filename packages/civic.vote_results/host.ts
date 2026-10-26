// The host the hub gave this package when it loaded it (./index.ts binds it):
// the adapters its admin controller sends the results' mail through.

import { storeSlot, type PluginHost } from "../../src/sdk/index.js";

export const voteResultsHost = storeSlot<PluginHost>("civic.vote_results host");
