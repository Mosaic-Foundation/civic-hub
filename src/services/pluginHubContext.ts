// hubContext(): what a package may know about the hub in scope (Events 2, E3):
// what it calls itself, the address its pages are at, and its clock. Public
// facts all three: the name and the zone are public settings, the address is
// where anyone reaches it. Read per call, so a package never holds one hub's
// answer while serving another.

import { KEYS, getSettingSync, hubDisplayNameSync } from "./hubSettings.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { resolveTimeZone } from "../utils/hubTime.js";

export interface HubContext {
  /** What the hub calls itself (`identity.name`, else its registry name). */
  name: string;
  /** The origin its pages are at, no trailing slash: links in a calendar file or a message. */
  baseUrl: string;
  /** Its IANA time zone (`identity.timezone`), "UTC" when unset. */
  timeZone: string;
}

export function hubContext(): HubContext {
  return {
    name: hubDisplayNameSync(),
    baseUrl: uiBaseUrl(),
    timeZone: resolveTimeZone(getSettingSync(KEYS.IDENTITY_TIMEZONE)),
  };
}
