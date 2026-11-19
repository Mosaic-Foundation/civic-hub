// The Pinning plugin's rules (features/pinning/rules.ts): when a pin is up,
// which end dates are refused, and who may pin.

import { describe, expect, it } from "vitest";
import { isPinActive, pinEndDateProblem, whoCanPinOf } from "../../features/pinning/rules.js";

const now = Date.parse("2026-11-15T12:00:00Z");
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("isPinActive", () => {
  it("a pin with no end date stays up", () => {
    expect(isPinActive({ pinned_until: null }, now)).toBe(true);
  });

  it("an end date that has passed reads as off, one still ahead as on", () => {
    expect(isPinActive({ pinned_until: iso(now - 1) }, now)).toBe(false);
    expect(isPinActive({ pinned_until: iso(now + day) }, now)).toBe(true);
  });
});

describe("pinEndDateProblem", () => {
  it("a pin needs no date, and refuses a past date or a non-date", () => {
    expect(pinEndDateProblem(null, now)).toBeNull();
    expect(pinEndDateProblem(iso(now + day), now)).toBeNull();
    expect(pinEndDateProblem(iso(now - day), now)).toMatch(/already passed/);
    expect(pinEndDateProblem("soon", now)).toMatch(/not a date/);
  });
});

describe("whoCanPinOf", () => {
  it("is admins only unless the space says every member", () => {
    expect(whoCanPinOf(undefined)).toBe("admins");
    expect(whoCanPinOf("")).toBe("admins");
    expect(whoCanPinOf("anyone")).toBe("admins");
    expect(whoCanPinOf("members")).toBe("members");
    expect(whoCanPinOf(" members ")).toBe("members");
  });
});
