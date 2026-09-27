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

export type JurisdictionType = "county" | "city" | "town" | "village" | "school_district" | "other";

export const JURISDICTION_TYPES: ReadonlyArray<{ id: JurisdictionType; label: string }> = [
  { id: "county", label: "County" },
  { id: "city", label: "City" },
  { id: "town", label: "Town" },
  { id: "village", label: "Village" },
  { id: "school_district", label: "School district" },
  { id: "other", label: "Other" },
];

export function isJurisdictionType(value: unknown): value is JurisdictionType {
  return typeof value === "string" && JURISDICTION_TYPES.some((t) => t.id === value);
}

/**
 * The usual governing body for a type of place, or "" when there is no
 * usual one. Counties differ by state: Virginia's are governed by a Board of
 * Supervisors, most others by a County Commission (Adam, 2026-09-26). The
 * state comes from the jurisdiction code (`us-va-…`).
 */
export function defaultGoverningBody(type: JurisdictionType | null | undefined, jurisdictionCode?: string | null): string {
  switch (type) {
    case "county":
      return /^us-va-/.test(jurisdictionCode ?? "") ? "Board of Supervisors" : "County Commission";
    case "city":
      return "City Council";
    case "town":
      return "Town Council";
    case "village":
      return "Village Board";
    case "school_district":
      return "School Board";
    default:
      return "";
  }
}
