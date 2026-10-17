// Legal 1.4 (2026-10-17): a non-material revision doesn't ask anyone to accept
// again. Whoever accepted 1.3 is current; older or no acceptance is not.

import { describe, expect, it } from "vitest";
import {
  CURRENT_LEGAL_VERSION,
  LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE,
  legalAcceptanceIsCurrent,
} from "../../src/shared/legal.js";

describe("who is asked to accept the documents again", () => {
  it("the current version, and 1.3 (1.4 is non-material), count as accepted", () => {
    expect(CURRENT_LEGAL_VERSION).toBe("1.4");
    expect(LEGAL_VERSIONS_NOT_REQUIRING_REACCEPTANCE).toEqual(["1.3"]);
    expect(legalAcceptanceIsCurrent("1.4")).toBe(true);
    expect(legalAcceptanceIsCurrent("1.3")).toBe(true);
  });

  it("an older version, or none, is asked as before", () => {
    expect(legalAcceptanceIsCurrent("1.2")).toBe(false);
    expect(legalAcceptanceIsCurrent(null)).toBe(false);
    expect(legalAcceptanceIsCurrent(undefined)).toBe(false);
    expect(legalAcceptanceIsCurrent("")).toBe(false);
  });
});
