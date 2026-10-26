// The host the hub gave this package when it loaded it (./index.ts binds it):
// its database (its granted tables only), and the adapters the conversation
// reaches Polis and the AI through.

import { storeSlot, type PluginHost } from "../../src/sdk/index.js";

export const conversationHost = storeSlot<PluginHost>("civic.polis_deliberation host");
