// The `addressSuggest` adapter on Mapbox's Geocoding API v6 (Adam,
// 2026-11-17): address suggestions as a member types their address to find
// their district. Settings: MAPBOX_ACCESS_TOKEN (unset: not configured).
//
// What the member types travels only in this request's query string: not in
// a variable that outlives the call, an error, a log line or an error report,
// and nothing Mapbox answers is stored. Every failure is rethrown as one
// plain message without the URL (which carries the text and the token).
//
// Near the hub: Mapbox ranks by a point, and the hub knows only its place's
// name, so the place is looked up once per server instance (by its name,
// never a member's text) and its point is cached.

import { hostingEnv } from "../config/env.js";
import { guardedFetch } from "../utils/ssrfGuard.js";
import type { AddressSuggester } from "../adapters/addressSuggest.js";

const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";
const LIMIT = 5;

interface MapboxFeature {
  geometry?: { coordinates?: unknown };
  properties?: { full_address?: unknown; name?: unknown; place_formatted?: unknown };
}

/** The addresses in a v6 forward answer (exported for its unit test; pure). */
export function addressesFromMapbox(body: unknown): string[] {
  const features = (body as { features?: MapboxFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: string[] = [];
  for (const f of features) {
    const p = f?.properties ?? {};
    const full =
      typeof p.full_address === "string"
        ? p.full_address
        : typeof p.name === "string"
          ? [p.name, typeof p.place_formatted === "string" ? p.place_formatted : ""].filter(Boolean).join(", ")
          : "";
    const address = full.replace(/,\s*United States$/i, "").trim();
    if (address && !out.includes(address)) out.push(address);
  }
  return out.slice(0, LIMIT);
}

/** The first feature's point as "lng,lat", or null (exported for its unit test; pure). */
export function pointFromMapbox(body: unknown): string | null {
  const c = (body as { features?: MapboxFeature[] } | null)?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  return `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
}

async function forward(params: Record<string, string>): Promise<unknown> {
  const token = hostingEnv.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error("Mapbox is not configured.");
  const query = new URLSearchParams({ ...params, country: "us", access_token: token });
  try {
    const res = await guardedFetch(`${ENDPOINT}?${query.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      maxBytes: 1_000_000,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch {
    // Deliberately drops the cause: it can carry the URL, which carries the text and the token.
    throw new Error("Mapbox could not be reached.");
  }
}

/** Each hub place's point, by name. A place Mapbox can't place is cached as null, so it is asked once. */
const places = new Map<string, string | null>();

async function pointNear(place: string): Promise<string | null> {
  if (places.has(place)) return places.get(place)!;
  let point: string | null;
  try {
    point = pointFromMapbox(await forward({ q: place, types: "district,place,locality,region", limit: "1" }));
  } catch {
    // Suggestions still come, just not ranked by the hub's place; asked again next time.
    return null;
  }
  places.set(place, point);
  return point;
}

export const mapboxAddresses: AddressSuggester = {
  name: "mapbox",
  configured: () => Boolean(hostingEnv.MAPBOX_ACCESS_TOKEN),
  async suggest(text: string, near: string | null): Promise<string[]> {
    const proximity = near ? await pointNear(near) : null;
    const body = await forward({
      q: text,
      autocomplete: "true",
      types: "address",
      limit: String(LIMIT),
      ...(proximity ? { proximity } : {}),
    });
    return addressesFromMapbox(body);
  },
};
