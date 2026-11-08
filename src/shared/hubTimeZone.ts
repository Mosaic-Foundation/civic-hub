// The hub's clock, in one place (Events 3, 2026-11-08, Adam): the zone its
// admin set (`identity.timezone`); when none is set, the zone of the hub's
// place, from the state in its jurisdiction code or OCD id; when it has no
// place either, UTC. Events (its page, its feed card, a new event's
// default), the calendar feed and the digest all read it through
// hubContext() / hubTimeZone() on the server, and the UI through
// /hub-config's `time_zone`, so none of them says "UTC" for a hub that is
// somewhere.
//
// `source` says which: "set" (the admin chose or confirmed it), "place"
// (inferred; Settings → Identity asks the admin to confirm it, and Getting
// started's first step waits for that), "default" (UTC, no place).
//
// Shared by the server and the UI. Pure.

import { suggestedTimeZone, US_TIME_ZONES } from "./stateTimeZones.js";

export type HubTimeZoneSource = "set" | "place" | "default";

export interface HubTimeZone {
  zone: string;
  source: HubTimeZoneSource;
}

function isZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The state's two letters, from an OCD id (`…/state:va/…`) or a code (`us-va-…`). */
function stateOf(jurisdictionCode: string | null | undefined, ocdId: string | null | undefined): string | null {
  return (
    /\/(?:state|district):([a-z]{2})(?:\/|$)/.exec(ocdId ?? "")?.[1] ??
    /^us-([a-z]{2})(?:-|$)/.exec((jurisdictionCode ?? "").toLowerCase())?.[1] ??
    null
  );
}

/** The zone the hub's place suggests, or "" when it has none. */
export function placeTimeZone(jurisdictionCode: string | null | undefined, ocdId?: string | null): string {
  const zone = suggestedTimeZone(stateOf(jurisdictionCode, ocdId));
  return isZone(zone) ? zone : "";
}

/** The hub's zone: the setting, else its place's, else UTC; and which it is. */
export function effectiveHubTimeZone(
  setting: string | null | undefined,
  jurisdictionCode: string | null | undefined,
  ocdId?: string | null,
): HubTimeZone {
  const set = setting?.trim() ?? "";
  if (isZone(set)) return { zone: set, source: "set" };
  const place = placeTimeZone(jurisdictionCode, ocdId);
  if (place) return { zone: place, source: "place" };
  return { zone: "UTC", source: "default" };
}

/**
 * A zone in plain words for a sentence: "Eastern" for America/New_York (the
 * dropdown's US names), else its city ("London").
 */
export function zonePlainName(zone: string): string {
  const us = US_TIME_ZONES.find((z) => z.id === zone)?.label;
  if (us) return us.split(/[,(]/)[0]!.trim();
  if (zone === "UTC") return "UTC";
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}
