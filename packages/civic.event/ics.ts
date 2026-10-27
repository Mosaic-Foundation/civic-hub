// The hub's calendar as iCalendar (RFC 5545), for any calendar app to
// subscribe to. Pure: the route hands it the calendar's rows.

import { locationLine } from "./event.js";
import type { CalendarRow } from "./store.js";

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newlines escaped. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** A UTC DATE-TIME: 20261101T170000Z. */
function utc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.1: lines of at most 75 octets, continued with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a UTF-8 sequence: back up off continuation bytes.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // the continuation's leading space counts
  }
  return parts.join("\r\n ");
}

export interface IcsOptions {
  /** The calendar's name: the hub's. */
  name: string;
  /** Stable per-hub host part for UIDs. */
  uidDomain: string;
  /** The event page's absolute URL. */
  eventUrl(processId: string): string;
  /** DTSTAMP: when the feed was generated. */
  now: string;
}

export function toIcs(rows: readonly CalendarRow[], opts: IcsOptions): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Civic Social//Civic Hub Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
  ];
  for (const row of rows) {
    const url = opts.eventUrl(row.process_id);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${row.process_id}@${opts.uidDomain}`,
      `DTSTAMP:${utc(opts.now)}`,
      `DTSTART:${utc(row.start_time)}`,
      `DTEND:${utc(row.end_time)}`,
      `SUMMARY:${escapeText(row.cancelled ? `Cancelled: ${row.title}` : row.title)}`,
      `STATUS:${row.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      `LOCATION:${escapeText(row.location.type === "Link" ? row.location.href : locationLine(row.location))}`,
      `URL:${url}`,
    );
    const description = [row.description.trim(), url].filter(Boolean).join("\n\n");
    lines.push(`DESCRIPTION:${escapeText(description)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
