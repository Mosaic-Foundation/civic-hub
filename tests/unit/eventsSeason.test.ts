/**
 * Events 0.3.0's own logic (packages/civic.event): the form's end and
 * duration kept together, the default end, what a change tells the people
 * going, and the checks on a zone, a limit and a picture.
 */
import { describe, expect, it } from "vitest";
import {
  capacityOf,
  changeText,
  defaultEnd,
  durationMinutes,
  endAfter,
  formatDuration,
  imageOf,
  parseDuration,
  timeZoneOf,
  type EventState,
} from "../../packages/civic.event/event.js";


describe("end and duration", () => {
  it("a start's default end is an hour after it", () => {
    expect(defaultEnd("2030-06-01T17:00:00.000Z", "UTC")).toBe("2030-06-01T18:00:00.000Z");
  });

  it("stays on the start's day in the event's zone", () => {
    // 23:30 in Chicago: ends at 23:59 that day, not tomorrow.
    expect(defaultEnd("2030-06-02T04:30:00.000Z", "America/Chicago")).toBe("2030-06-02T04:59:00.000Z");
  });

  it("duration and end follow each other, both from the start", () => {
    const start = "2030-06-01T17:00:00.000Z";
    expect(durationMinutes(start, endAfter(start, 90))).toBe(90);
    expect(durationMinutes(start, start)).toBeNull();
    expect(durationMinutes(null, start)).toBeNull();
  });

  it.each([
    ["90", 90],
    ["90m", 90],
    ["1:30", 90],
    ["1h30", 90],
    ["1 h 30 min", 90],
    ["2 hours", 120],
    ["1.5h", 90],
    ["1 day", 1440],
    ["", null],
    ["soon", null],
    ["0", null],
    ["1:75", null],
  ])("reads %j as %j minutes", (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it("writes a duration back the way it reads", () => {
    for (const m of [45, 60, 90, 1500]) expect(parseDuration(formatDuration(m))).toBe(m);
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});

describe("what a change tells the people going", () => {
  const before: EventState = {
    start_time: "2030-06-01T17:00:00.000Z",
    end_time: "2030-06-01T19:00:00.000Z",
    location: { type: "Place", name: "Community room" },
    cancelled: null,
    time_zone: "America/Chicago",
  };

  it("the new time and the old, in the event's zone", () => {
    const text = changeText(before, { ...before, start_time: "2030-06-01T18:00:00.000Z", end_time: "2030-06-01T20:00:00.000Z" });
    expect(text).toContain("When: Saturday, June 1, 2030, 1:00 PM – 3:00 PM CDT");
    expect(text).toContain("(was Saturday, June 1, 2030, 12:00 PM – 2:00 PM CDT)");
    expect(text).not.toContain("Where");
  });

  it("the new place and the old", () => {
    const text = changeText(before, { ...before, location: { type: "Link", name: "Online", href: "https://meet.example/r" } });
    expect(text).toBe("Where: Online: https://meet.example/r\n(was Community room)");
  });

  it("nothing for a change of words or picture, or an event before 0.3.0 given its zone at the same hour", () => {
    expect(changeText(before, { ...before, capacity: 10, image: { url: "https://x.example/types/civic.event/a.png", alt: "" } })).toBeNull();
    // An older event, edited: it is given the hub's zone, its hour unchanged.
    expect(changeText({ ...before, time_zone: undefined }, before)).toBeNull();
  });
});

describe("the checks", () => {
  it("a zone this runtime knows", () => {
    expect(timeZoneOf("Europe/Paris")).toBe("Europe/Paris");
    expect(timeZoneOf("")).toBeNull();
    expect(() => timeZoneOf("Nowhere/Special")).toThrow(/not a time zone/);
  });

  it("a limit from 1", () => {
    expect(capacityOf("40")).toBe(40);
    expect(capacityOf("")).toBeNull();
    for (const bad of ["0", "-1", "2.5", "lots", 100_001]) expect(() => capacityOf(bad), String(bad)).toThrow();
  });

  it("a picture only from the hub's upload route for events", () => {
    expect(imageOf("https://store.example/hub/types/civic.event/2030/05/a.webp", " A room ")).toEqual({
      url: "https://store.example/hub/types/civic.event/2030/05/a.webp",
      alt: "A room",
    });
    expect(imageOf("", "x")).toBeNull();
    for (const bad of ["https://elsewhere.example/a.png", "javascript:alert(1)", "not a url", "https://store.example/hub/types/civic.vote/a.png"]) {
      expect(() => imageOf(bad, ""), bad).toThrow();
    }
  });
});
