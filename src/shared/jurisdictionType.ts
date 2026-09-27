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

/**
 * The usual governing body for a type of place, or "" when there is no
 * usual one. Counties differ by state: Virginia's are governed by a Board of
 * Supervisors, most others by a County Commission (Adam, 2026-09-26). The
 * state comes from the OCD id (`…/state:va/…`) when there is one, otherwise
 * from the jurisdiction code (`us-va-…`).
 */
export function defaultGoverningBody(
  type: JurisdictionType | null | undefined,
  jurisdictionCode?: string | null,
  ocdId?: string | null,
): string {
  switch (type) {
    case "county": {
      const state = stateOfOcdId(ocdId) ?? /^us-([a-z]{2})-/.exec(jurisdictionCode ?? "")?.[1] ?? null;
      return state === "va" ? "Board of Supervisors" : "County Commission";
    }
    case "city":
      return "City Council";
    case "town":
      return "Town Council";
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
