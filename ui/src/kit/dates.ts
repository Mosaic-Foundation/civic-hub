// The kit's day arithmetic (Events 3, 2026-11-08): which calendar day an
// instant falls on in a zone, a day's heading, items grouped by day, and a
// day moved by days or months. Pure; shared by the page patterns, the
// calendar views and a package's page (@civic-social/plugin-sdk/ui).

/** "Saturday, November 15" (and the year when it is not this one), in the zone given. */
export function dayHeading(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const thisYear = new Date().toLocaleDateString("en-US", { timeZone, year: "numeric" });
  const year = d.toLocaleDateString("en-US", { timeZone, year: "numeric" });
  return d.toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(year !== thisYear ? { year: "numeric" as const } : {}),
  });
}

/** The calendar day an instant falls on in the zone given, as "YYYY-MM-DD". */
export function dayKey(iso: string | Date, timeZone?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Items in date order, grouped by the day each falls on in the zone given. */
export function groupByDay<T>(items: readonly T[], when: (item: T) => string, timeZone?: string): Array<{ day: string; date: string; items: T[] }> {
  const groups: Array<{ day: string; date: string; items: T[] }> = [];
  for (const item of items) {
    const iso = when(item);
    const day = dayKey(iso, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, date: iso, items: [item] });
  }
  return groups;
}

/** A calendar day moved by days and months, as "YYYY-MM-DD" (no zone involved). */
export function shiftDay(day: string, days: number, months = 0): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const lastOfTarget = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + months, months ? Math.min(d, lastOfTarget) : d + days));
  return t.toISOString().slice(0, 10);
}

