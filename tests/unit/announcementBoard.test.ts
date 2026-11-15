// Pinned and urgent announcements: the shared rules (src/shared/announcementBoard.ts).

import { describe, expect, it } from "vitest";
import { endDateProblem, isPinnedNow, isUrgentNow, URGENT_MAX_DAYS } from "../../src/shared/announcementBoard.js";

const now = Date.parse("2026-11-15T12:00:00Z");
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("isPinnedNow / isUrgentNow", () => {
  it("an older announcement with no marks is neither", () => {
    expect(isPinnedNow({}, now)).toBe(false);
    expect(isUrgentNow({}, now)).toBe(false);
  });

  it("a pin with no end date stays up", () => {
    expect(isPinnedNow({ pinned: true, pinned_until: null }, now)).toBe(true);
  });

  it("an end date that has passed reads as off, one still ahead as on", () => {
    expect(isPinnedNow({ pinned: true, pinned_until: iso(now - 1) }, now)).toBe(false);
    expect(isPinnedNow({ pinned: true, pinned_until: iso(now + day) }, now)).toBe(true);
    expect(isUrgentNow({ urgent: true, urgent_until: iso(now - 1) }, now)).toBe(false);
    expect(isUrgentNow({ urgent: true, urgent_until: iso(now + day) }, now)).toBe(true);
  });

  it("unpinned or not urgent is off whatever the date", () => {
    expect(isPinnedNow({ pinned: false, pinned_until: iso(now + day) }, now)).toBe(false);
    expect(isUrgentNow({ urgent: false, urgent_until: iso(now + day) }, now)).toBe(false);
  });
});

describe("endDateProblem", () => {
  it("urgent needs a date; a pin does not", () => {
    expect(endDateProblem(null, { required: true, now })).toMatch(/Choose the date/);
    expect(endDateProblem(null, { required: false, now })).toBeNull();
  });

  it("refuses a past date, a non-date, and one too far ahead", () => {
    expect(endDateProblem(iso(now - day), { required: false, now })).toMatch(/already passed/);
    expect(endDateProblem("soon", { required: false, now })).toMatch(/not a date/);
    expect(endDateProblem(iso(now + (URGENT_MAX_DAYS + 2) * day), { required: true, maxDays: URGENT_MAX_DAYS, now })).toMatch(/at most 30 days/);
  });

  it("takes the end of the last allowed day", () => {
    expect(endDateProblem(iso(now + URGENT_MAX_DAYS * day + 11 * 3_600_000), { required: true, maxDays: URGENT_MAX_DAYS, now })).toBeNull();
  });
});
