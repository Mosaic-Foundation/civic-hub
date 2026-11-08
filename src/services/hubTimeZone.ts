// The hub in scope's clock (Events 3, 2026-11-08): its time zone setting,
// else its place's zone, else UTC (src/shared/hubTimeZone.ts says why). The
// one server reader: hubContext() (Events, the calendar feed), the digest,
// sign-in codes and the closed-early line all ask here.

import { currentHub } from "../config/hubContext.js";
import { KEYS } from "../models/hubSettings.js";
import { effectiveHubTimeZone, type HubTimeZone } from "../shared/hubTimeZone.js";
import { getSettingSync } from "./hubSettings.js";

/** The zone and where it came from, for the hub serving this request. */
export function hubTimeZoneInfo(): HubTimeZone {
  return effectiveHubTimeZone(getSettingSync(KEYS.IDENTITY_TIMEZONE), currentHub()?.jurisdiction_code ?? null);
}

/** The IANA zone of the hub serving this request. */
export function hubTimeZone(): string {
  return hubTimeZoneInfo().zone;
}
