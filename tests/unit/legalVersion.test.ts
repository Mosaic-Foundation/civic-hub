// Legal 1.5 (2026-11-17): a material revision of the Privacy Policy (About
// you, and what a ballot's district and age group give up), so everyone is
// asked to accept again: 1.4 and 1.3 no longer count.

import { describe, expect, it } from "vitest";
import {
  CURRENT_LEGAL_LAST_UPDATED,
  CURRENT_LEGAL_VERSION,
  LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE,
  legalAcceptanceIsCurrent,
} from "../../src/shared/legal.js";

describe("who is asked to accept the documents again", () => {
  it("only the current version counts as accepted", () => {
    expect(CURRENT_LEGAL_VERSION).toBe("1.5");
    expect(CURRENT_LEGAL_LAST_UPDATED).toBe("2026-11-17");
    expect(LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE).toEqual([]);
    expect(legalAcceptanceIsCurrent("1.5")).toBe(true);
  });

  it("1.4, 1.3, an older version, or none, is asked", () => {
    for (const v of ["1.4", "1.3", "1.2", null, undefined, ""]) expect(legalAcceptanceIsCurrent(v), String(v)).toBe(false);
  });
});
