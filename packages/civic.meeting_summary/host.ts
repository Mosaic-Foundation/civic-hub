// The host the hub gave this package when it loaded it (./index.ts binds it):
// the adapters its job reads meeting pages and recordings, summarizes and tells
// the admins through.

import { storeSlot, type PluginHost } from "@civic-social/plugin-sdk/first-party";

export const meetingSummaryHost = storeSlot<PluginHost>("civic.meeting_summary host");
