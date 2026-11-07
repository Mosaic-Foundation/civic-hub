import { describe, expect, it } from "vitest";
import { comingUpRows, dateTile, timeOfDay } from "./comingUp";
import { pageHasAside } from "./asidePages";
import type { AsideFacts, CalendarEventRow } from "../services/api";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

function event(id: string, start: string, more: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return { process_id: id, title: id, start_time: start, end_time: start, cancelled: false, time_zone: null, ...more };
}

function facts(deadlines: Array<{ id: string; at: string; type?: string }>): AsideFacts {
  return {
    deadlines: deadlines.map((d) => ({ process_id: d.id, type: d.type ?? "civic.vote", title: d.id, closes_at: d.at, url: `/process/${d.id}` })),
    announcements: [],
    about: { member_count: null },
  };
}

const rows = (f: AsideFacts | null, e: CalendarEventRow[] | null) =>
  comingUpRows({ facts: f, events: e, calendarTypes: ["civic.event"], eventPath: (id) => `/events/${id}`, hubTimeZone: null, now: NOW });

describe("Coming up (Adam, 2026-11-07)", () => {
  it("merges events and closing dates, earliest first", () => {
    const r = rows(facts([{ id: "vote", at: day(2) }]), [event("fair", day(1)), event("hall", day(3))]);
    expect(r.map((x) => [x.key, x.kind])).toEqual([
      ["event:fair", "event"],
      ["deadline:vote", "deadline"],
      ["event:hall", "event"],
    ]);
    expect(r[0]!.url).toBe("/events/fair");
    expect(r[1]!.url).toBe("/process/vote");
  });

  it("looks fourteen days ahead, five rows at most, and leaves out a cancelled event and what is past", () => {
    const r = rows(
      facts([{ id: "late", at: day(15) }, { id: "gone", at: day(-1) }, ...[1, 2, 3, 4, 5].map((n) => ({ id: `v${n}`, at: day(n) }))]),
      [event("off", day(1), { cancelled: true }), event("e6", day(6))],
    );
    expect(r.map((x) => x.key)).toEqual(["deadline:v1", "deadline:v2", "deadline:v3", "deadline:v4", "deadline:v5"]);
  });

  it("leaves out an event's own deadline: the calendar has it", () => {
    const r = rows(facts([{ id: "fair", at: day(2), type: "civic.event" }]), [event("fair", day(1))]);
    expect(r.map((x) => x.key)).toEqual(["event:fair"]);
    expect(rows(facts([{ id: "fair", at: day(2), type: "civic.event" }]), null)).toEqual([]);
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
