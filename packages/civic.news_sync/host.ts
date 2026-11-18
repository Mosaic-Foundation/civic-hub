// The host the hub gave this package when it loaded it (./index.ts binds it):
// the adapters its job reads the news feed and writes paraphrases through.

import { storeSlot, type PluginHost } from "@civic-social/plugin-sdk";

export const newsSyncHost = storeSlot<PluginHost>("civic.news_sync host");
