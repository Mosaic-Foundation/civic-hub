// A US state's main time zone (IANA name), for the console's Create hub
// suggestion (Adam, 2026-10-06). Only a suggestion: the operator can type
// another, and the hub's admin changes it later in Settings → Identity
// (`identity.timezone`). States split across zones suggest the zone most of
// their people live in, and are listed in SPLIT_STATES so the form can say
// "check this". Keys are the two lowercase letters of the OCD id.
//
// Shared by the server and the console. Pure.

export const STATE_TIME_ZONES: Readonly<Record<string, string>> = {
  al: "America/Chicago",
  ak: "America/Anchorage",
  az: "America/Phoenix",
  ar: "America/Chicago",
  ca: "America/Los_Angeles",
  co: "America/Denver",
  ct: "America/New_York",
  de: "America/New_York",
  dc: "America/New_York",
  fl: "America/New_York",
  ga: "America/New_York",
  hi: "Pacific/Honolulu",
  id: "America/Boise",
  il: "America/Chicago",
  in: "America/Indiana/Indianapolis",
  ia: "America/Chicago",
  ks: "America/Chicago",
  ky: "America/New_York",
  la: "America/Chicago",
  me: "America/New_York",
  md: "America/New_York",
  ma: "America/New_York",
  mi: "America/Detroit",
  mn: "America/Chicago",
  ms: "America/Chicago",
  mo: "America/Chicago",
  mt: "America/Denver",
  ne: "America/Chicago",
  nv: "America/Los_Angeles",
  nh: "America/New_York",
  nj: "America/New_York",
  nm: "America/Denver",
  ny: "America/New_York",
  nc: "America/New_York",
  nd: "America/Chicago",
  oh: "America/New_York",
  ok: "America/Chicago",
  or: "America/Los_Angeles",
  pa: "America/New_York",
  ri: "America/New_York",
  sc: "America/New_York",
  sd: "America/Chicago",
  tn: "America/Chicago",
  tx: "America/Chicago",
  ut: "America/Denver",
  vt: "America/New_York",
  va: "America/New_York",
  wa: "America/Los_Angeles",
  wv: "America/New_York",
  wi: "America/Chicago",
  wy: "America/Denver",
};

/** States with places in more than one time zone. */
export const SPLIT_STATES: ReadonlySet<string> = new Set([
  "ak", "fl", "id", "in", "ks", "ky", "mi", "ne", "nd", "or", "sd", "tn", "tx",
]);

/** The suggestion for a state, or "" when there is none (no state, a non-place hub). */
export function suggestedTimeZone(state: string | null | undefined): string {
  return STATE_TIME_ZONES[(state ?? "").toLowerCase()] ?? "";
}

/**
 * The US zones, first in every time zone dropdown, in plain words (Adam,
 * 2026-10-08: the console and start page had a text box).
 */
export const US_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Mountain, no daylight saving (Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

/**
 * Every other zone the runtime knows (`Intl.supportedValuesOf`), with
 * `current` kept even if the runtime does not list it, so a saved value is
 * never silently dropped.
 */
export function otherTimeZones(current = ""): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  const us = new Set(US_TIME_ZONES.map((z) => z.id));
  const rest = all.filter((z) => !us.has(z));
  return current && !us.has(current) && !rest.includes(current) ? [current, ...rest] : rest;
}
