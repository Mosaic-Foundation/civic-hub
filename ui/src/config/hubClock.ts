// The hub's clock for the UI (Events 3, 2026-11-08): the zone every time is
// shown in. /hub-config's `time_zone` (the setting, else the place's zone,
// else UTC: src/shared/hubTimeZone.ts), or the raw setting from an older
// server. Host-provided to packages through @civic-social/plugin-sdk/ui, so a
// package's page and its feed card read the same answer as the hub's.

import { getLoadedHubConfig, setting } from "./hubConfig";

/** The IANA zone the hub's times are shown in. */
export function hubTimeZone(): string {
  return getLoadedHubConfig()?.time_zone?.zone || setting("identity.timezone") || "UTC";
}
