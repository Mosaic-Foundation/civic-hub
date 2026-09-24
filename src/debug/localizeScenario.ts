// Seed scenarios in the hub's own names.
//
// The default demo set (seedData.ts) was written about Floyd County and named
// it in every sentence, so a hub that seeded it described somebody else's
// county. The scenarios now say {PLACE}, {GOVERNING_BODY} and {JURISDICTION},
// and this fills them from the hub being seeded — Floyd's seed reads exactly
// as it did, and any other hub gets the same civic questions about itself.
//
// Outside a hub scope (the boot-time auto-seed) the readers fall back to the
// environment, like every other hub-identity read.

import { civicPlaceShortName, DEFAULT_JURISDICTION, civicPlaceCode } from "../config/hub.js";
import { getSettingSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";

export interface ScenarioNames {
  /** "Floyd County" — `{PLACE}`. */
  place: string;
  /** "Board of Supervisors" — `{GOVERNING_BODY}`. */
  governing_body: string;
  /** "us-va-floyd" — `{JURISDICTION}`, the place code for `jurisdiction`. */
  jurisdiction: string;
}

/** The names of the hub in scope, with neutral stand-ins for a hub with none. */
export function scenarioNames(): ScenarioNames {
  return {
    place: civicPlaceShortName() ?? "the county",
    governing_body: getSettingSync(KEYS.COPY_GOVERNING_BODY_NAME)?.trim() || "Board",
    jurisdiction: civicPlaceCode() ?? DEFAULT_JURISDICTION,
  };
}

/**
 * A deep copy of `scenario` with every `{PLACE}`, `{GOVERNING_BODY}` and
 * `{JURISDICTION}` in every string replaced. Keys are untouched.
 */
export function localizeScenario<T>(scenario: T, names: ScenarioNames = scenarioNames()): T {
  const fill = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value
        .replaceAll("{PLACE}", names.place)
        .replaceAll("{GOVERNING_BODY}", names.governing_body)
        .replaceAll("{JURISDICTION}", names.jurisdiction);
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
    }
    return value;
  };
  return fill(scenario) as T;
}
