// "Find my district" (districts and demographics, Adam 2026-11-16): a member
// types their address; the hub asks the geocoder adapter (the US Census
// Bureau's free geocoder) which county subdivision it is in, matches that
// name to the hub's own district list, and answers with the match for the
// member to confirm. Nothing is saved until they confirm.
//
// THE ADDRESS IS NEVER KEPT OR LOGGED. It lives only in this call: it is
// not stored, not put in an error (every failure answers in plain words
// without it), and not passed to reportError. Ten lookups an hour per
// member, so the hub is never a free geocoder for anyone.

import { CivicError, ValidationError } from "../errors/index.js";
import { HOUR_MS, takeRateLimit } from "../db/rateLimit.js";
import { adapters } from "../adapters/index.js";
import {
  DISTRICTS_MAX,
  DISTRICT_NAME_MAX,
  districtIdFrom,
  matchDistrict,
  type AboutConfig,
  type District,
} from "../shared/aboutYou.js";
import { countyGeoidForHub } from "../db/hubs.js";

export const ADDRESS_MAX = 200;
export const LOOKUPS_PER_HOUR = 10;

export interface DistrictLookupAnswer {
  /** The hub's district the address is in, for the member to confirm; null when there is no match. */
  match: District | null;
  /** Why there is no match, in the member's words; null when there is one. */
  reason: "not_found" | "no_match" | "unavailable" | null;
}

export async function lookUpDistrict(userId: string, rawAddress: unknown, config: AboutConfig): Promise<DistrictLookupAnswer> {
  if (!config.questions.district) throw new ValidationError("This hub does not ask for a district.", "question_off");
  const address = typeof rawAddress === "string" ? rawAddress.replace(/\s+/g, " ").trim() : "";
  if (address.length < 5 || address.length > ADDRESS_MAX) {
    throw new ValidationError("Enter a street address, with the town or ZIP code.", "bad_address");
  }
  const geocoder = adapters().geocoder;
  if (!geocoder.configured()) return { match: null, reason: "unavailable" };

  const refused = await takeRateLimit([{ scope: "about.district_lookup", by: "user", value: userId, limit: LOOKUPS_PER_HOUR, windowMs: HOUR_MS }]);
  if (refused) {
    throw new CivicError(429, "too_many_lookups", "That's a lot of lookups. Choose your district from the list, or try again in an hour.");
  }

  let place;
  try {
    place = await geocoder.locate(address);
  } catch {
    // Not reported: the adapter's error says nothing useful, and nothing here may carry the address.
    return { match: null, reason: "unavailable" };
  }
  if (!place?.countySubdivision) return { match: null, reason: "not_found" };
  const match = matchDistrict(place.countySubdivision, config.districts);
  return match ? { match, reason: null } : { match: null, reason: "no_match" };
}

/**
 * A district name as people say it, from the Census's: "Court House district"
 * → "Court House", "Locust Grove magisterial district" → "Locust Grove".
 * Adam, 2026-11-16: the plain word is District, not "magisterial district".
 */
export function plainDistrictName(censusName: string): string {
  const plain = censusName
    .replace(/\s+(magisterial|election|supervisor|council|voting)?\s*(district|ward|precinct)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain || censusName.trim();
}

/**
 * The hub's districts as the Census lists them, ready to save: its county's
 * subdivisions, plainly named, each with an id. Null when the hub's place is
 * not a county the Census knows, or the Census can't be reached. Nothing is
 * saved here: the admin sees the list and saves it (Settings > Districts).
 */
export async function districtsFromCensus(hubId: string): Promise<District[] | null> {
  const geoid = await countyGeoidForHub(hubId);
  if (!geoid) return null;
  const names = await adapters().geocoder.countySubdivisions(geoid);
  if (!names || names.length === 0) return null;
  const out: District[] = [];
  for (const name of names.map(plainDistrictName)) {
    if (out.some((d) => d.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ id: districtIdFrom(name, out.map((d) => d.id)), name: name.slice(0, DISTRICT_NAME_MAX) });
  }
  return out.slice(0, DISTRICTS_MAX);
}
