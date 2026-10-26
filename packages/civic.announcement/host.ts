// The host the hub gave this package when it loaded it (./index.ts binds it):
// the adapters its publication receipt sends mail through.

import { storeSlot, type PluginHost } from "../../src/sdk/index.js";

export const announcementHost = storeSlot<PluginHost>("civic.announcement host");
