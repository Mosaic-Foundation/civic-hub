// Names derived from a jurisdiction reference row (20260927000000): the slug
// candidates the console offers, and the jurisdiction code the create form
// fills in. Shared by the server (src/control/jurisdictions.ts) and the
// console UI. Pure; names no place.

import type { ReferenceJurisdictionType } from "./jurisdictionType.js";

/** The Census's type words at the end of an official name, per type. */
const TYPE_SUFFIX: Record<ReferenceJurisdictionType, RegExp> = {
  state: /$^/,
  county: /\s+(county|parish|census area|city and borough|borough|municipality)$/i,
  city: /\s+city$/i,
  town: /\s+town$/i,
  village: /\s+village$/i,
  borough: /\s+(city and borough|borough|municipality)$/i,
  cdp: /\s+cdp$/i,
  school_district: /$^/,
};

/** The word a type adds to a slug: floyd-town, floyd-county. */
const TYPE_WORD: Record<ReferenceJurisdictionType, string> = {
  state: "state",
  county: "county",
  city: "city",
  town: "town",
  village: "village",
  borough: "borough",
  cdp: "cdp",
  school_district: "schools",
};

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The official name without the Census's type word: "Floyd town" → "Floyd". */
export function baseName(officialName: string, type: ReferenceJurisdictionType): string {
  return officialName.replace(TYPE_SUFFIX[type], "").trim() || officialName;
}

/**
 * Slug candidates, shortest first, in the order Adam set (2026-09-27): the
 * plain name, then name + type, then name + state, then name + a number.
 * Shape only; whether each is free is the server's question.
 */
export function slugCandidates(name: string, type: ReferenceJurisdictionType | null, state: string | null, max = 12): string[] {
  const base = fitSlug(slugify(name));
  if (!base) return [];
  const out = [base];
  if (type) out.push(`${fitSlug(base, SLUG_MAX - TYPE_WORD[type].length - 1)}-${TYPE_WORD[type]}`);
  if (state) out.push(`${fitSlug(base, SLUG_MAX - state.length - 1)}-${state}`);
  for (let n = 2; out.length < max; n++) {
    const suffix = `-${n}`;
    out.push(`${fitSlug(base, SLUG_MAX - suffix.length)}${suffix}`);
  }
  return [...new Set(out)];
}

/** The longest suggested slug: a hub's web address and permanent id. */
export const SLUG_MAX = 32;

/** Words a long name can lose without becoming another name. */
const SLUG_FILLER = new Set(["the", "of", "and", "administrative", "unified", "consolidated", "independent", "public", "community"]);

/**
 * A slug cut to `max` characters at a word boundary, never mid-word (review
 * R20: "…-administrative-scho"). Too long, it first loses filler words
 * ("bend-la-pine-administrative-school-district-1" →
 * "bend-la-pine-school-district-1"), then whole words from the end.
 */
export function fitSlug(slug: string, max = SLUG_MAX): string {
  const s = slug.replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const words = s.split("-").filter((w, i) => i === 0 || !SLUG_FILLER.has(w));
  const joined = words.join("-");
  if (joined.length <= max) return joined;
  let acc = "";
  for (const w of words) {
    const next = acc ? `${acc}-${w}` : w;
    if (next.length > max) break;
    acc = next;
  }
  // A single word longer than max: nothing to keep whole, so cut it.
  return acc || s.slice(0, max).replace(/-+$/, "");
}

/** The word a code adds for a jurisdiction below county level. */
const CODE_WORD: Partial<Record<ReferenceJurisdictionType, string>> = {
  city: "city",
  town: "town",
  village: "village",
  borough: "borough",
  cdp: "cdp",
  school_district: "schools",
};

/**
 * A hub's jurisdiction code (`hubs.jurisdiction_code`, the Civic Activity
 * Spec's `civic:code`), derived from its OCD id ONCE, at creation, and never
 * recomputed (Adam, 2026-09-27; the `protocol_hub_id` pattern), so a code a
 * hub has published never changes.
 *
 * The rule: `us-<state>` for a state; `us-<state>-<name>` for a county, a
 * parish or an Alaska borough; `us-<state>-<name>-<type>` for anything else
 * (city, town, village, borough, cdp, schools). <name> is every OCD segment
 * below the state, broadest first, underscores as hyphens (so a school
 * district nested under its county carries the county too). So a county keeps the code hubs have always
 * published (`us-va-floyd`), and a town in it gets its own (`us-va-floyd-town`).
 * Null when the id has no state (a custom hub has no id, and so no code).
 */
export function jurisdictionCodeFor(row: { ocd_id: string; type: ReferenceJurisdictionType }): string | null {
  const m = /^ocd-division\/country:us\/(?:state|district):([a-z]{2})(?:\/.*)?$/.exec(row.ocd_id);
  if (!m) return null;
  const state = m[1];
  if (row.type === "state") return `us-${state}`;
  // Every segment after the state, broadest first: a school district sits
  // under its county in the OCD list (…/county:floyd/school_district:…), and
  // the same district name recurs in other counties.
  const below = row.ocd_id.split("/").slice(3).map((seg) => seg.split(":")[1] ?? "");
  const name = slugify(below.join("-").replace(/_/g, "-"));
  if (!name) return null;
  const word = CODE_WORD[row.type];
  return word ? `us-${state}-${name}-${word}` : `us-${state}-${name}`;
}

/**
 * A new place hub's default name (Adam, 2026-10-06): the place as shown,
 * without its state, then "Civic Hub". "Floyd County, Virginia" → "Floyd
 * County Civic Hub"; "Town of Floyd, Virginia" → "Town of Floyd Civic Hub".
 * Only the last ", …" goes, so a typed name with no state is kept whole.
 */
export function defaultHubName(placeName: string): string {
  const place = placeName.trim().replace(/,\s*[^,]+$/, "").trim();
  return place ? `${place} Civic Hub` : "";
}
