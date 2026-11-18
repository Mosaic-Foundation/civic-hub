// The Pinned card's rules: the hub's pins (src/shared/pinRules.ts) and
// Announcements' urgent label (packages/civic.announcement/board.ts).

import { describe, expect, it } from "vitest";
import { isPinActive, pinEndDateProblem } from "../../src/shared/pinRules.js";
import { endDateProblem, isUrgentNow, URGENT_MAX_DAYS } from "../../packages/civic.announcement/board.js";

const now = Date.parse("2026-11-15T12:00:00Z");
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("isPinActive / isUrgentNow", () => {
  it("a pin with no end date stays up; an older announcement with no marks is not urgent", () => {
    expect(isPinActive({ pinned_until: null }, now)).toBe(true);
    expect(isUrgentNow({}, now)).toBe(false);
  });

  it("an end date that has passed reads as off, one still ahead as on", () => {
    expect(isPinActive({ pinned_until: iso(now - 1) }, now)).toBe(false);
    expect(isPinActive({ pinned_until: iso(now + day) }, now)).toBe(true);
    expect(isUrgentNow({ urgent: true, urgent_until: iso(now - 1) }, now)).toBe(false);
    expect(isUrgentNow({ urgent: true, urgent_until: iso(now + day) }, now)).toBe(true);
  });

  it("not urgent is off whatever the date", () => {
    expect(isUrgentNow({ urgent: false, urgent_until: iso(now + day) }, now)).toBe(false);
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

describe("endDateProblem (urgent)", () => {
  it("urgent needs a date", () => {
    expect(endDateProblem(null, { required: true, now })).toMatch(/Choose the date/);
  });

  it("refuses a past date, a non-date, and one too far ahead", () => {
    expect(endDateProblem(iso(now - day), { required: true, now })).toMatch(/already passed/);
    expect(endDateProblem("soon", { required: true, now })).toMatch(/not a date/);
    expect(endDateProblem(iso(now + (URGENT_MAX_DAYS + 2) * day), { required: true, maxDays: URGENT_MAX_DAYS, now })).toMatch(/at most 30 days/);
  });

  it("takes the end of the last allowed day", () => {
    expect(endDateProblem(iso(now + URGENT_MAX_DAYS * day + 11 * 3_600_000), { required: true, maxDays: URGENT_MAX_DAYS, now })).toBeNull();
  });
});
