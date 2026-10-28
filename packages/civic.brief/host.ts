// The host the hub gave this package when it loaded it (./index.ts binds it):
// the adapters its admin controller sends the brief's mail through.

import { storeSlot, type PluginHost } from "@civic-social/plugin-sdk/first-party";

export const briefHost = storeSlot<PluginHost>("civic.brief host");
