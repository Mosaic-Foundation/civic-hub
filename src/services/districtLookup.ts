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
  encodeCensusDistricts,
  matchDistrict,
  parseCensusDistricts,
  parseDistricts,
  type AboutConfig,
  type District,
} from "../shared/aboutYou.js";
import { countyGeoidForHub } from "../db/hubs.js";
import { KEYS, getSetting, setSetting } from "./hubSettings.js";

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
 * A county's districts as the Census lists them: its subdivisions, plainly
 * named, each with an id made from its name. Null when the Census can't be
 * reached or lists none.
 *
 * The ids are made in the Census's (alphabetical) order from the plain
 * names, so the same county always gives the same ids. They are kept once
 * stored (ensureCensusDistricts), and Settings > Districts starts the
 * admin's own list from them, so a ballot tagged "court-house" from the
 * Census list keeps its district when the admin later saves a list.
 */
export async function districtsForCounty(countyGeoid: string): Promise<District[] | null> {
  const names = await adapters().geocoder.countySubdivisions(countyGeoid);
  if (!names || names.length === 0) return null;
  const out: District[] = [];
  for (const name of names.map(plainDistrictName)) {
    if (out.some((d) => d.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ id: districtIdFrom(name, out.map((d) => d.id)), name: name.slice(0, DISTRICT_NAME_MAX) });
  }
  return out.slice(0, DISTRICTS_MAX);
}

/** How long one server instance trusts what it last found for a hub before checking again. */
export const CENSUS_RECHECK_MS = 6 * HOUR_MS;
/** How long a hub's page waits for the Census on its first visit before going on without it. */
export const CENSUS_WAIT_MS = 4_000;

const checkedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/** Forget what this instance has checked (tests). */
export function resetCensusDistrictChecks(): void {
  checkedAt.clear();
  inFlight.clear();
}

/**
 * A county hub with no district list of its own uses the Census's, with no
 * admin work (Adam, 2026-11-17): the first time it is needed, the county's
 * subdivisions are fetched and kept in `about.census_districts`, which every
 * reader (the member card, Settings > About you, breakdowns, the address
 * lookup) falls back to while `about.districts` is empty
 * (src/shared/aboutYou.ts aboutConfig). An admin's saved list overrides it.
 *
 * Called on the hub config read, so a new county hub's first page view
 * fills it. Cheap after that: once checked, an instance looks again only
 * after CENSUS_RECHECK_MS, and then re-fetches only when the hub's county
 * changed. A hub moved off a county has its kept list cleared. Never throws:
 * a failure leaves the hub as it was, to try again later.
 */
export function ensureCensusDistricts(hubId: string, now: number = Date.now()): Promise<void> {
  const last = checkedAt.get(hubId);
  if (last !== undefined && now - last < CENSUS_RECHECK_MS) return Promise.resolve();
  const running = inFlight.get(hubId);
  if (running) return running;
  const job = (async () => {
    try {
      if (parseDistricts(await getSetting(hubId, KEYS.ABOUT_DISTRICTS)).length > 0) return;
      const kept = parseCensusDistricts(await getSetting(hubId, KEYS.ABOUT_CENSUS_DISTRICTS));
      const county = await countyGeoidForHub(hubId);
      if (!county) {
        if (kept) await setSetting(hubId, KEYS.ABOUT_CENSUS_DISTRICTS, "", null);
        return;
      }
      if (kept?.county === county) return;
      const districts = await districtsForCounty(county);
      if (!districts?.length) {
        // Not reached, or nothing listed: try again on the next check, not every request.
        return;
      }
      await setSetting(hubId, KEYS.ABOUT_CENSUS_DISTRICTS, encodeCensusDistricts(county, districts), null);
    } catch (err) {
      console.error(`[districts] the Census list for ${hubId} could not be kept`, err instanceof Error ? err.message : err);
    } finally {
      checkedAt.set(hubId, now);
      inFlight.delete(hubId);
    }
  })();
  inFlight.set(hubId, job);
  return job;
}

/** ensureCensusDistricts, waiting at most CENSUS_WAIT_MS so a slow Census never holds a page up for long. */
export async function ensureCensusDistrictsBriefly(hubId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    ensureCensusDistricts(hubId),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CENSUS_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}
