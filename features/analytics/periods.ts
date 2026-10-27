// Calendar periods in the hub's own time zone (ADR-016): a week starts on
// Monday, a quarter in January, April, July or October, and "all" runs from
// the hub's first recorded event. Dates are local YYYY-MM-DD strings. Pure.

export const PERIOD_KINDS = ["week", "month", "quarter", "all"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface Period {
  kind: PeriodKind;
  /** First local day, inclusive. */
  start: string;
  /** Last local day, inclusive (the natural end; a current period is read to date). */
  end: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(v: unknown): v is string {
  return typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function isPeriodKind(v: unknown): v is PeriodKind {
  return typeof v === "string" && (PERIOD_KINDS as readonly string[]).includes(v);
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Today's local date in `tz`. */
export function todayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The period of `kind` containing `day`; "all" runs from `launch`. */
export function periodOf(kind: PeriodKind, day: string, launch: string): Period {
  const d = utc(day);
  if (kind === "week") {
    const back = (d.getUTCDay() + 6) % 7;
    const start = addDays(day, -back);
    return { kind, start, end: addDays(start, 6) };
  }
  if (kind === "month") {
    const start = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const end = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    return { kind, start, end };
  }
  if (kind === "quarter") {
    const q = Math.floor(d.getUTCMonth() / 3) * 3;
    const start = iso(new Date(Date.UTC(d.getUTCFullYear(), q, 1)));
    const end = iso(new Date(Date.UTC(d.getUTCFullYear(), q + 3, 0)));
    return { kind, start, end };
  }
  return { kind, start: launch, end: day };
}

/** The period before `p` (none before "all"). */
export function previousPeriod(p: Period, launch: string): Period | null {
  if (p.kind === "all") return null;
  return periodOf(p.kind, addDays(p.start, -1), launch);
}

/** Every period of `kind` from the one holding `launch` to the one holding `today`. */
export function periodsBetween(kind: PeriodKind, launch: string, today: string): Period[] {
  if (kind === "all") return [periodOf("all", today, launch)];
  const out: Period[] = [];
  for (let p = periodOf(kind, launch, launch); p.start <= today; p = periodOf(kind, addDays(p.end, 1), launch)) out.push(p);
  return out;
}

/** "Week of 20 October 2026", "October 2026", "Q4 2026", "Since 3 March 2026". */
export function periodLabel(p: Period): string {
  const d = utc(p.start);
  const long = (x: Date) => x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  if (p.kind === "week") return `Week of ${long(d)}`;
  if (p.kind === "month") return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  if (p.kind === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  return `Since ${long(d)}`;
}
