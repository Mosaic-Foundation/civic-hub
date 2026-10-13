import { describe, expect, it } from "vitest";
import { closedEarlyLine, daysEarly, readClosedEarly } from "../../src/shared/closedEarly.js";

describe("Close early: the line every surface shows", () => {
  it("counts calendar days in the hub's time zone", () => {
    const record = { at: "2026-10-13T15:00:00Z", original_deadline: "2026-10-16T15:00:00Z" };
    expect(daysEarly(record, "America/New_York")).toBe(3);
    expect(closedEarlyLine(record, "America/New_York")).toBe(
      "Closed early on October 13, 2026, 3 days before the original date of October 16, 2026.",
    );
  });

  it("a late-evening close counts by the hub's date, not UTC's", () => {
    // 11pm Oct 13 in New York is already Oct 14 in UTC.
    const record = { at: "2026-10-14T03:00:00Z", original_deadline: "2026-10-15T16:00:00Z" };
    expect(daysEarly(record, "America/New_York")).toBe(2);
    expect(daysEarly(record, "UTC")).toBe(1);
    expect(closedEarlyLine(record, "America/New_York")).toContain("October 13, 2026, 2 days before");
  });

  it("one day, and the same day", () => {
    expect(closedEarlyLine({ at: "2026-10-13T12:00:00Z", original_deadline: "2026-10-14T12:00:00Z" }, "UTC")).toBe(
      "Closed early on October 13, 2026, 1 day before the original date of October 14, 2026.",
    );
    expect(closedEarlyLine({ at: "2026-10-13T09:00:00Z", original_deadline: "2026-10-13T21:00:00Z" }, "UTC")).toBe(
      "Closed early on October 13, 2026, earlier on the original closing day.",
    );
  });

  it("reads only a whole record", () => {
    expect(readClosedEarly({ at: "a", original_deadline: "b", note: "c" })).toEqual({ at: "a", original_deadline: "b", note: "c" });
    expect(readClosedEarly({ at: "a", note: "c" })).toBeNull();
    expect(readClosedEarly(null)).toBeNull();
  });
});
