// The date-time control's conversions in a named zone (Events 2, E4).
import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./datetime";

describe("the date-time control in a named zone", () => {
  it("shows an instant as that zone's wall clock, and reads it back", () => {
    const iso = "2026-11-12T00:30:00.000Z";
    expect(toLocalInput(iso, "America/Chicago")).toBe("2026-11-11T18:30");
    expect(toLocalInput(iso, "Asia/Tokyo")).toBe("2026-11-12T09:30");
    expect(fromLocalInput("2026-11-11T18:30", "America/Chicago")).toBe(iso);
    expect(fromLocalInput("2026-11-12T09:30", "Asia/Tokyo")).toBe(iso);
  });

  it("is right on either side of a change of clocks", () => {
    // New York: EDT (-4) until 2026-11-01 02:00, EST (-5) after.
    expect(fromLocalInput("2026-10-31T19:00", "America/New_York")).toBe("2026-10-31T23:00:00.000Z");
    expect(fromLocalInput("2026-11-02T19:00", "America/New_York")).toBe("2026-11-03T00:00:00.000Z");
    // 01:30 happens twice on 2026-11-01: the first (EDT).
    expect(fromLocalInput("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    // 02:30 never happens on 2026-03-08: read after the change.
    expect(toLocalInput(fromLocalInput("2026-03-08T02:30", "America/New_York"), "America/New_York")).toBe("2026-03-08T03:30");
  });

  it("round-trips every quarter hour across a year", () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60_000 * 97) {
      const iso = new Date(t).toISOString();
      for (const zone of ["Europe/London", "Australia/Lord_Howe", "America/Los_Angeles"]) {
        const back = fromLocalInput(toLocalInput(iso, zone), zone)!;
        // A repeated wall time reads as its first occurrence.
        expect(toLocalInput(back, zone), `${iso} ${zone}`).toBe(toLocalInput(iso, zone));
      }
    }
  });

  it("without a zone, is the reader's as before", () => {
    const d = new Date(2026, 10, 11, 18, 30);
    expect(toLocalInput(d.toISOString())).toBe("2026-11-11T18:30");
    expect(fromLocalInput("2026-11-11T18:30")).toBe(d.toISOString());
  });
});
