// Districts and demographics (Adam, 2026-11-16): what a member may tell the
// hub about themselves ("About you"), and the words and groups the hub's
// results are broken down by.
//
// A member's answers are theirs: only they see them (Settings > About you),
// and they leave with the account. Admins and plugins never see one person's
// answers; results show totals by ONE of these groups at a time, with any
// group of fewer than five people hidden (src/services/breakdowns.ts).
//
// Settings (src/models/hubSettings.ts KEYS, section "districts"):
//   about.district_term, about.district_term_plural   what the hub calls a district
//   about.districts                                    the list, JSON [{ id, name }]
//   about.census_districts                             the county's list from the Census,
//                                                      kept by the hub itself (not the admin):
//                                                      used while about.districts is empty
//   about.ask_district / ask_birth_year / ask_race     which questions are on
//
// Plain data, shared with the UI: imports nothing but other shared files.

/** The setting keys, here as well as in KEYS so the UI can read them without the server's model. */
export const ABOUT_KEYS = {
  DISTRICT_TERM: "about.district_term",
  DISTRICT_TERM_PLURAL: "about.district_term_plural",
  DISTRICTS: "about.districts",
  CENSUS_DISTRICTS: "about.census_districts",
  ASK_DISTRICT: "about.ask_district",
  ASK_BIRTH_YEAR: "about.ask_birth_year",
  ASK_RACE: "about.ask_race",
} as const;

/** The questions, by id. A ballot tag and a breakdown dimension share the id (race too). */
export const ABOUT_QUESTIONS = ["district", "birth_year", "race"] as const;
export type AboutQuestion = (typeof ABOUT_QUESTIONS)[number];

/** Which questions are on when a hub has not said: district and birth year on, race off. */
export const QUESTION_DEFAULTS: Readonly<Record<AboutQuestion, boolean>> = {
  district: true,
  birth_year: true,
  race: false,
};

const ASK_KEY: Readonly<Record<AboutQuestion, string>> = {
  district: ABOUT_KEYS.ASK_DISTRICT,
  birth_year: ABOUT_KEYS.ASK_BIRTH_YEAR,
  race: ABOUT_KEYS.ASK_RACE,
};

/** A setting reader: the raw stored value, or undefined. */
export type SettingReader = (key: string) => string | undefined;

function flag(raw: string | undefined, fallback: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/** One district, as the hub lists it. The id is kept when the name changes, so past ballots keep their district. */
export interface District {
  id: string;
  name: string;
}

export const DISTRICTS_MAX = 100;
export const DISTRICT_NAME_MAX = 80;
export const DISTRICT_ID_SHAPE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** A district's id made from its name: "Court House" → "court-house". */
export function districtIdFrom(name: string, taken: readonly string[] = []): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "district";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The hub's districts, from the stored JSON. A corrupt value reads as none. */
export function parseDistricts(raw: string | undefined): District[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: District[] = [];
    for (const entry of list) {
      const { id, name } = (entry ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id !== "string" || typeof name !== "string" || !DISTRICT_ID_SHAPE.test(id) || !name.trim()) continue;
      if (out.some((d) => d.id === id)) continue;
      out.push({ id, name: name.trim() });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The Census's districts for a county hub, as the hub keeps them
 * (`about.census_districts`, written by src/services/districtLookup.ts, never
 * by an admin): the county they are for, and the list. Null when there is none
 * or the stored value is corrupt.
 */
export interface CensusDistricts {
  /** The county's Census code (state and county FIPS), so a hub moved to another county refetches. */
  county: string;
  districts: District[];
}

export function parseCensusDistricts(raw: string | undefined): CensusDistricts | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const value = JSON.parse(raw) as { county?: unknown; districts?: unknown };
    if (typeof value?.county !== "string" || !/^\d{5}$/.test(value.county)) return null;
    const districts = parseDistricts(JSON.stringify(value.districts ?? []));
    return districts.length ? { county: value.county, districts } : null;
  } catch {
    return null;
  }
}

/** The stored form of a county's Census districts. */
export function encodeCensusDistricts(county: string, districts: readonly District[]): string {
  return JSON.stringify({ county, districts });
}

/**
 * What a district is called when the admin hasn't said: "District", on every
 * kind of hub (Adam, 2026-11-17: ward, precinct or borough is the admin's to
 * choose, not ours to guess from the kind of place).
 */
export const DEFAULT_DISTRICT_TERM: Readonly<{ singular: string; plural: string }> = { singular: "District", plural: "Districts" };

/** A plural for an admin's own singular: "Precinct" → "Precincts". */
export function pluralOf(singular: string): string {
  const s = singular.trim();
  if (!s) return s;
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(s)) return `${s}es`;
  return `${s}s`;
}

/** Everything the hub's pages need to ask and to show, from its settings. */
export interface AboutConfig {
  term: { singular: string; plural: string };
  districts: District[];
  /**
   * Where the list comes from: the admin's saved list ("hub"), the county's
   * Census list while the admin has saved none ("census"), or nowhere ("none").
   */
  districtSource: "hub" | "census" | "none";
  /** Which questions are asked. District is asked only when there are districts to choose from. */
  questions: Record<AboutQuestion, boolean>;
}

export function aboutConfig(read: SettingReader): AboutConfig {
  const fallback = DEFAULT_DISTRICT_TERM;
  const singular = read(ABOUT_KEYS.DISTRICT_TERM)?.trim() || fallback.singular;
  const ownSingular = !!read(ABOUT_KEYS.DISTRICT_TERM)?.trim();
  const plural =
    read(ABOUT_KEYS.DISTRICT_TERM_PLURAL)?.trim() || (ownSingular ? pluralOf(singular) : fallback.plural);
  // The admin's list wins; with none saved, a county hub uses its Census list
  // (Adam, 2026-11-17: a county hub needs no admin work to ask for a district).
  const saved = parseDistricts(read(ABOUT_KEYS.DISTRICTS));
  const census = saved.length ? [] : (parseCensusDistricts(read(ABOUT_KEYS.CENSUS_DISTRICTS))?.districts ?? []);
  const districts = saved.length ? saved : census;
  const districtSource = saved.length ? "hub" : census.length ? "census" : "none";
  const questions = {} as Record<AboutQuestion, boolean>;
  for (const q of ABOUT_QUESTIONS) questions[q] = flag(read(ASK_KEY[q]), QUESTION_DEFAULTS[q]);
  if (districts.length === 0) questions.district = false;
  return {
    term: { singular, plural },
    districts,
    districtSource,
    questions,
  };
}

/** Whether the hub asks anything at all (the one-time card shows only then). */
export function asksAnything(config: AboutConfig): boolean {
  return ABOUT_QUESTIONS.some((q) => config.questions[q]);
}

// --- Age -------------------------------------------------------------------

export const AGE_BRACKETS = ["18-24", "25-34", "35-49", "50-64", "65-74", "75+"] as const;
export type AgeBracket = (typeof AGE_BRACKETS)[number];

export const AGE_BRACKET_LABELS: Readonly<Record<AgeBracket, string>> = {
  "18-24": "18 to 24",
  "25-34": "25 to 34",
  "35-49": "35 to 49",
  "50-64": "50 to 64",
  "65-74": "65 to 74",
  "75+": "75 and over",
};

/** The earliest birth year the form offers, and how young a member may be. */
export const BIRTH_YEAR_MIN = 1900;
export const MIN_AGE = 13;

/**
 * The bracket a birth year falls in at `now`, by year alone (no birthday is
 * stored, so a person is counted at the age they turn this year). Under 18:
 * no bracket, counted as not provided.
 */
export function ageBracket(birthYear: number | null | undefined, now: Date = new Date()): AgeBracket | null {
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear)) return null;
  const age = now.getUTCFullYear() - birthYear;
  if (age < 18 || age > 130) return null;
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 49) return "35-49";
  if (age <= 64) return "50-64";
  if (age <= 74) return "65-74";
  return "75+";
}

// --- Race ------------------------------------------------------------------

/**
 * The choices, after the US federal standard (OMB SPD 15, 2024). A member may
 * pick more than one; in results they count once in each group they picked.
 */
export const RACE_OPTIONS = [
  { id: "american_indian_alaska_native", label: "American Indian or Alaska Native" },
  { id: "asian", label: "Asian" },
  { id: "black", label: "Black or African American" },
  { id: "hispanic_latino", label: "Hispanic or Latino" },
  { id: "middle_eastern_north_african", label: "Middle Eastern or North African" },
  { id: "native_hawaiian_pacific_islander", label: "Native Hawaiian or Pacific Islander" },
  { id: "white", label: "White" },
  { id: "another", label: "Another race or ethnicity" },
] as const;
export type RaceId = (typeof RACE_OPTIONS)[number]["id"];
export const RACE_IDS: readonly string[] = RACE_OPTIONS.map((r) => r.id);

// --- A member's answers ------------------------------------------------------

/** One member's answers, as only they see them. */
export interface AboutAnswers {
  district_id: string | null;
  birth_year: number | null;
  race: string[];
  /** The questions they answered "Prefer not to say". */
  declined: AboutQuestion[];
  /** When they were first asked (the card, or Settings); null: never. */
  asked_at: string | null;
}

export const EMPTY_ANSWERS: AboutAnswers = { district_id: null, birth_year: null, race: [], declined: [], asked_at: null };

// --- Matching a Census name to the hub's list ------------------------------------

/** A district name reduced for a loose match: "Court House district" and "Courthouse" read the same. */
export function looseDistrictName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(magisterial|election|supervisor|council|school board|board|voting)\b/g, " ")
    .replace(/\b(district|ward|precinct|township|town|borough|division|ccd)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** The hub's district a Census name stands for, or null. */
export function matchDistrict(censusName: string, districts: readonly District[]): District | null {
  const want = looseDistrictName(censusName);
  if (!want) return null;
  return districts.find((d) => looseDistrictName(d.name) === want) ?? null;
}
