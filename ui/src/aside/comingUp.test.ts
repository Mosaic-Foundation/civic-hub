import { describe, expect, it } from "vitest";
import { comingUpRows, dateTile, timeOfDay } from "./comingUp";
import { pageHasAside } from "./asidePages";
import type { CalendarEventRow } from "../services/api";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

function event(id: string, start: string, more: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return { process_id: id, title: id, start_time: start, end_time: start, cancelled: false, time_zone: null, ...more };
}

const rows = (e: CalendarEventRow[] | null) =>
  comingUpRows({ events: e, eventPath: (id) => `/events/${id}`, hubTimeZone: null, now: NOW });

describe("Coming up (Adam, 2026-11-07; events only, 2026-11-09)", () => {
  it("is the calendar's events, earliest first", () => {
    const r = rows([event("hall", day(3)), event("fair", day(1))]);
    expect(r.map((x) => x.key)).toEqual(["event:fair", "event:hall"]);
    expect(r[0]!.url).toBe("/events/fair");
  });

  it("looks as far ahead as it must, three rows at most, and leaves out a cancelled event and what is past", () => {
    const r = rows([
      event("gone", day(-1)),
      event("off", day(1), { cancelled: true }),
      event("e90", day(90)),
      event("e20", day(20)),
      event("e200", day(200)),
      event("e300", day(300)),
    ]);
    // Weeks and months out, since nothing is nearer (Adam, 2026-11-07: no window).
    expect(r.map((x) => x.key)).toEqual(["event:e20", "event:e90", "event:e200"]);
  });

  it("is nothing when the calendar is off or empty", () => {
    expect(rows(null)).toEqual([]);
    expect(rows([])).toEqual([]);
  });

  it("dates a row in its zone, and ignores a zone the browser doesn't know", () => {
    expect(dateTile("2026-11-08T03:00:00Z", "America/New_York")).toEqual({ month: "Nov", day: "7" });
    expect(timeOfDay("2026-11-08T03:00:00Z", "America/New_York")).toBe("10:00 PM");
    expect(dateTile("2026-11-08T03:00:00Z", "Not/AZone").month).toBe("Nov");
  });
});

describe("the pages with a right column", () => {
  it("are the public pages but your settings, legal and info pages, sign-in, search and admin", () => {
    for (const p of ["/", "/votes", "/process/abc", "/events/x", "/my-submissions", "/members"]) expect(pageHasAside(p), p).toBe(true);
    for (const p of ["/settings", "/about", "/terms", "/privacy", "/code-of-conduct", "/welcome", "/sign-in", "/search", "/admin", "/admin/settings/theme", "/about/"]) {
      expect(pageHasAside(p), p).toBe(false);
    }
  });
});
