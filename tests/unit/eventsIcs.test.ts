/**
 * The Events plugin's calendar as iCalendar (packages/civic.event/ics.ts):
 * RFC 5545 lines (CRLF, folded at 75 octets without splitting a character),
 * text escaped, times in UTC, a cancelled event marked, each event's page
 * linked.
 */
import { describe, it, expect } from "vitest";
import { toIcs } from "../../packages/civic.event/ics.js";
import type { CalendarRow } from "../../packages/civic.event/store.js";

const ROW: CalendarRow = {
  process_id: "proc_1",
  title: "Neighbours' evening; bring a dish, please",
  description: "Line one\nLine two",
  start_time: "2030-06-01T17:00:00.000Z",
  end_time: "2030-06-01T19:30:00.000Z",
  location: { type: "Place", name: "Community room", address: { type: "PostalAddress", streetAddress: "1 Example Street" } },
  cancelled: false,
  archived: false,
};

const OPTS = {
  name: "Events · hub.example",
  uidDomain: "hub.example",
  eventUrl: (id: string) => `https://hub.example/events/${id}`,
  now: "2030-05-01T12:00:00.000Z",
};

/** The unfolded content lines. */
const lines = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);

describe("the calendar as iCalendar", () => {
  it("writes one VEVENT per event, with UTC times, escaped text and the event's page", () => {
    const out = lines(toIcs([ROW], OPTS));
    expect(out[0]).toBe("BEGIN:VCALENDAR");
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("X-WR-CALNAME:Events · hub.example");
    expect(out).toContain("UID:proc_1@hub.example");
    expect(out).toContain("DTSTAMP:20300501T120000Z");
    expect(out).toContain("DTSTART:20300601T170000Z");
    expect(out).toContain("DTEND:20300601T193000Z");
    expect(out).toContain("SUMMARY:Neighbours' evening\\; bring a dish\\, please");
    expect(out).toContain("STATUS:CONFIRMED");
    expect(out).toContain("LOCATION:Community room\\, 1 Example Street");
    expect(out).toContain("URL:https://hub.example/events/proc_1");
    expect(out).toContain("DESCRIPTION:Line one\\nLine two\\n\\nhttps://hub.example/events/proc_1");
    expect(out[out.length - 1]).toBe("END:VCALENDAR");
  });

  it("marks a cancelled event, and gives an online one its link as the location", () => {
    const out = lines(
      toIcs([{ ...ROW, cancelled: true, location: { type: "Link", name: "Online", href: "https://meet.example/room" } }], OPTS),
    );
    expect(out).toContain("STATUS:CANCELLED");
    expect(out.find((l) => l.startsWith("SUMMARY:"))).toMatch(/^SUMMARY:Cancelled: /);
    expect(out).toContain("LOCATION:https://meet.example/room");
  });

  it("ends every line with CRLF and folds long ones at 75 octets without splitting a character", () => {
    const long = { ...ROW, description: "é".repeat(200) };
    const ics = toIcs([long], OPTS);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
    for (const physical of ics.split("\r\n")) {
      expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
      expect(physical).not.toContain("�");
    }
    expect(lines(ics).find((l) => l.startsWith("DESCRIPTION:"))).toContain("é".repeat(200));
  });

  it("is an empty calendar when nothing is on it", () => {
    expect(lines(toIcs([], OPTS))).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Civic Social//Civic Hub Events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Events · hub.example",
      "END:VCALENDAR",
    ]);
  });
});
