// The `geocoder` adapter on the US Census Bureau's free geocoder
// (geocoding.geo.census.gov; no key). Districts and demographics, Adam
// 2026-11-16: a member's address is sent once to find their county
// subdivision (in Virginia counties, the magisterial district), matched to
// the hub's own district list, and never kept.
//
// The address travels only in this request's query string: not in a
// variable that outlives the call, an error, a log line or an error report.
// Every failure is rethrown as one plain message without the URL.

import { guardedFetch } from "../utils/ssrfGuard.js";
import type { AddressPlace, DistrictGeocoder } from "../adapters/geocoder.js";

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

interface CensusGeography {
  NAME?: unknown;
  BASENAME?: unknown;
}

interface CensusAnswer {
  result?: {
    addressMatches?: Array<{ geographies?: Record<string, CensusGeography[] | undefined> }>;
  };
}

function nameOf(list: CensusGeography[] | undefined): string | null {
  const g = list?.[0];
  const name = typeof g?.NAME === "string" ? g.NAME : typeof g?.BASENAME === "string" ? g.BASENAME : null;
  return name?.trim() || null;
}

/** The place in a Census answer (exported for its unit test; pure). */
export function placeFromCensus(body: unknown): AddressPlace | null {
  const match = (body as CensusAnswer)?.result?.addressMatches?.[0];
  if (!match?.geographies) return null;
  const countySubdivision = nameOf(match.geographies["County Subdivisions"]);
  const county = nameOf(match.geographies["Counties"]);
  if (!countySubdivision && !county) return null;
  return { countySubdivision, county };
}

/**
 * The names in a TIGERweb answer for one county's subdivisions: features
 * with NAME ("Court House district"), sorted. The Census's placeholder for
 * land in no subdivision ("County subdivisions not defined") is dropped. Null
 * when the answer isn't a feature list. Pure; exported for its unit test.
 */
export function subdivisionNamesFromCensus(body: unknown): string[] | null {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return null;
  const names = new Set<string>();
  for (const f of features) {
    const name = (f as { attributes?: { NAME?: unknown } } | null)?.attributes?.NAME;
    if (typeof name === "string" && name.trim() && !/not defined/i.test(name)) names.add(name.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The Census's TIGERweb map service, County Subdivisions layer (no key; the
 * same current geography the geocoder answers from). The Census Data API
 * used before now sends keyless calls to a "Missing Key" page (2026-11-17).
 */
const SUBDIVISIONS_ENDPOINT = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/22/query";

export const censusGeocoder: DistrictGeocoder = {
  name: "census",
  configured: () => true,
  async locate(address: string): Promise<AddressPlace | null> {
    const params = new URLSearchParams({
      address,
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      layers: "all",
      format: "json",
    });
    let body: unknown;
    try {
      const res = await guardedFetch(`${ENDPOINT}?${params.toString()}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        maxBytes: 2_000_000,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      body = await res.json();
    } catch {
      // Deliberately drops the cause: it can carry the URL, and the URL carries the address.
      throw new Error("The Census geocoder could not be reached.");
    }
    return placeFromCensus(body);
  },
  async countySubdivisions(countyGeoid: string): Promise<string[] | null> {
    if (!/^\d{5}$/.test(countyGeoid)) return null;
    const params = new URLSearchParams({
      where: `STATE='${countyGeoid.slice(0, 2)}' AND COUNTY='${countyGeoid.slice(2)}'`,
      outFields: "NAME",
      returnGeometry: "false",
      f: "json",
    });
    try {
      const res = await guardedFetch(`${SUBDIVISIONS_ENDPOINT}?${params.toString()}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        maxBytes: 2_000_000,
      });
      if (!res.ok) return null;
      return subdivisionNamesFromCensus(await res.json());
    } catch {
      return null;
    }
  },
};
