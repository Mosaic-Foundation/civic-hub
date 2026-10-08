// What kind of place a hub serves (`identity.jurisdiction_type`, Phase 7),
// and the governing body that kind of place usually has.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Phase 7 — Sample content for new
// hubs". The console's Create hub form pre-fills `copy.governing_body_name`
// from the type; the operator can always correct it, because the usual name
// is only usual. The sample seed also reads the type, to leave out templates
// that would read wrong (a comprehensive plan on a school district's hub).
//
// Shared by the server and the console UI. Pure.

export type JurisdictionType = "county" | "city" | "town" | "village" | "borough" | "school_district" | "other";

// `borough` added 2026-09-27 with the jurisdiction reference list (Adam):
// Pennsylvania and New Jersey boroughs and Alaska's boroughs are general
// local governments, and a Borough Council is not a Town Council.
export const JURISDICTION_TYPES: ReadonlyArray<{ id: JurisdictionType; label: string }> = [
  { id: "county", label: "County" },
  { id: "city", label: "City" },
  { id: "town", label: "Town" },
  { id: "village", label: "Village" },
  { id: "borough", label: "Borough" },
  { id: "school_district", label: "School district" },
  { id: "other", label: "Other" },
];

/**
 * The precise type of a row in the `jurisdictions` reference table
 * (20260927000000). Wider than a hub's type: a hub's
 * `identity.jurisdiction_type` collapses `cdp` and `state` to "other"
 * (Adam, 2026-09-27) — a census-designated place has no government of its
 * own, and a state's legislature has no usual single name.
 */
export type ReferenceJurisdictionType =
  | "state"
  | "county"
  | "city"
  | "town"
  | "village"
  | "borough"
  | "cdp"
  | "school_district";

export const REFERENCE_JURISDICTION_TYPES: ReadonlyArray<{ id: ReferenceJurisdictionType; label: string }> = [
  { id: "county", label: "County" },
  { id: "city", label: "City" },
  { id: "town", label: "Town" },
  { id: "village", label: "Village" },
  { id: "borough", label: "Borough" },
  { id: "cdp", label: "Census-designated place" },
  { id: "school_district", label: "School district" },
  { id: "state", label: "State" },
];

export function isReferenceJurisdictionType(value: unknown): value is ReferenceJurisdictionType {
  return typeof value === "string" && REFERENCE_JURISDICTION_TYPES.some((t) => t.id === value);
}

/** A reference row's type as a hub's `identity.jurisdiction_type`. */
export function hubTypeFor(type: ReferenceJurisdictionType): JurisdictionType {
  return type === "cdp" || type === "state" ? "other" : type;
}

/** `ocd-division/country:us/state:va/...` → "va"; null when there is no state segment. */
export function stateOfOcdId(ocdId: string | null | undefined): string | null {
  const m = /\/state:([a-z]{2})(\/|$)/.exec(ocdId ?? "");
  return m ? m[1] : null;
}

export function isJurisdictionType(value: unknown): value is JurisdictionType {
  return typeof value === "string" && JURISDICTION_TYPES.some((t) => t.id === value);
}

/** States whose towns usually have a Selectboard, by postal code. */
const SELECTBOARD_STATES: ReadonlySet<string> = new Set(["ct", "ma", "me", "nh", "vt"]);

/**
 * The usual governing body for a type of place, or "" when there is no
 * usual one. Counties differ by state: Virginia's are governed by a Board of
 * Supervisors, most others by a County Commission (Adam, 2026-09-26). The
 * state comes from the OCD id (`…/state:va/…`) when there is one, otherwise
 * from the jurisdiction code (`us-va-…`). A New England town's is a
 * Selectboard (2026-10-07).
 */
export function defaultGoverningBody(
  type: JurisdictionType | null | undefined,
  jurisdictionCode?: string | null,
  ocdId?: string | null,
): string {
  const state = stateOfOcdId(ocdId) ?? /^us-([a-z]{2})-/.exec(jurisdictionCode ?? "")?.[1] ?? null;
  switch (type) {
    case "county":
      return state === "va" ? "Board of Supervisors" : "County Commission";
    case "city":
      return "City Council";
    case "town":
      // New England towns are governed by a Selectboard (review R33,
      // 2026-10-07): a town meeting elects it, and no Town Council exists.
      return state && SELECTBOARD_STATES.has(state) ? "Selectboard" : "Town Council";
    case "village":
      return "Village Board";
    case "borough":
      return "Borough Council";
    case "school_district":
      return "School Board";
    default:
      return "";
  }
}

/**
 * The short form of a governing body's name (`copy.governing_body_short`),
 * for pills and running text where the full name is long: "Supervisors
 * meeting summaries", "passing on to the Council" (Adam, 2026-10-06). The
 * distinctive word: "Board of Supervisors" → "Supervisors", "City Council" →
 * "Council", "County Commission" → "Commission", "Village Board" → "Board".
 * "School Board" stays whole, since "Board" alone loses what it is. A name
 * of one or two words that matches none of these is its own short form; a
 * longer one keeps its last word. "" for "".
 */
export function defaultGoverningBodyShort(name: string | null | undefined): string {
  const full = (name ?? "").trim().replace(/\s+/g, " ");
  if (!full) return "";
  // "… of <members>": the members are the short form ("Board of
  // Supervisors", "Town Board of Trustees", "Board of County
  // Commissioners"). Any other "of" names a place or a subject ("Tribal
  // Council of the Example Nation", "Board of Education"): read before it.
  const of = /^(.+?) of (.+)$/i.exec(full);
  if (of) {
    if (/\b(supervisors|trustees|commissioners|aldermen|selectmen|freeholders|directors|governors|regents|chosen freeholders)$/i.test(of[2])) {
      return of[2].replace(/^the /i, "");
    }
    return defaultGoverningBodyShort(of[1]);
  }
  if (/^school board$/i.test(full)) return full;
  const words = full.split(" ");
  const last = words[words.length - 1];
  if (/^(council|commission|board|court|assembly|legislature|trustees|selectboard|aldermen|supervisors|commissioners)$/i.test(last)) {
    return last;
  }
  return words.length <= 2 ? full : last;
}
