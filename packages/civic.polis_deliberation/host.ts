// The host the hub gave this package when it loaded it (./index.ts binds it):
// its database (its granted tables only), and the adapter the conversation
// reaches Polis through.

import { storeSlot, type PluginHost } from "@civic-social/plugin-sdk/first-party";

export const conversationHost = storeSlot<PluginHost>("civic.polis_deliberation host");
