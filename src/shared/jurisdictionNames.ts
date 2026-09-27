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
  const base = slugify(name).slice(0, 32).replace(/-+$/, "");
  if (!base) return [];
  const fit = (s: string) => s.slice(0, 32).replace(/-+$/, "");
  const out = [base];
  if (type) out.push(fit(`${base}-${TYPE_WORD[type]}`));
  if (state) out.push(fit(`${base}-${state}`));
  for (let n = 2; out.length < max; n++) {
    const suffix = `-${n}`;
    out.push(`${base.slice(0, 32 - suffix.length).replace(/-+$/, "")}${suffix}`);
  }
  return [...new Set(out)];
}

/**
 * The jurisdiction code the create form fills in, in the homemade form
 * `hubs.jurisdiction_code` has always had (`us-<state>-<name>`). Whether the
 * code stays independent, is derived from the OCD id, or is retired is open
 * (Adam, 2026-09-27); until then the form keeps the existing convention.
 */
export function jurisdictionCodeFor(row: { state: string; type: ReferenceJurisdictionType; official_name: string }): string {
  if (row.type === "state") return `us-${row.state}`;
  return `us-${row.state}-${slugify(baseName(row.official_name, row.type))}`;
}
