// When a scheduled job was due and when it is next due, from its five-field
// cron expression (UTC, src/jobs/registry.ts), and how late it may be.
//
// Pure. The grace rule is the heartbeats' (scripts/heartbeats-sync.ts makes
// each Healthchecks.io check with it), so the console's Dashboard calls a job
// late exactly when its heartbeat would go down.
//
// Supports what the registry uses and a little more: `*`, numbers, lists,
// ranges and steps (`*/6`, `0-30/10`) in every field. Day-of-month and
// day-of-week combine as cron does: when both are restricted, either matches.

const MINUTE_MS = 60_000;
/** Far enough to find any schedule in the registry; a malformed one gives up. */
const SEARCH_LIMIT_MINUTES = 8 * 24 * 60;

type Field = { values: Set<number>; any: boolean };

function parseField(raw: string, min: number, max: number): Field | null {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      [lo, hi] = rangePart.split("-").map(Number);
    } else {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, any: raw === "*" };
}

interface Cron {
  minute: Field;
  hour: Field;
  dom: Field;
  month: Field;
  dow: Field;
}

function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4].replace(/\b7\b/g, "0"), 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow };
}

function matches(c: Cron, d: Date): boolean {
  if (!c.minute.values.has(d.getUTCMinutes()) || !c.hour.values.has(d.getUTCHours())) return false;
  if (!c.month.values.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.values.has(d.getUTCDate());
  const dowOk = c.dow.values.has(d.getUTCDay());
  if (c.dom.any || c.dow.any) return domOk && dowOk;
  return domOk || dowOk;
}

function startOfMinute(d: Date): number {
  return Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS;
}

/** The first time strictly after `from` the schedule fires, or null for a malformed one. */
export function nextRun(schedule: string, from: Date): Date | null {
  const c = parseCron(schedule);
  if (!c) return null;
  let t = startOfMinute(from) + MINUTE_MS;
  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++, t += MINUTE_MS) {
    if (matches(c, new Date(t))) return new Date(t);
  }
  return null;
}

/** The last time at or before `at` the schedule fired, or null for a malformed one. */
export function previousRun(schedule: string, at: Date): Date | null {
  const c = parseCron(schedule);
  if (!c) return null;
  let t = startOfMinute(at);
  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++, t -= MINUTE_MS) {
    if (matches(c, new Date(t))) return new Date(t);
  }
  return null;
}

/** How late a run may be before it counts as missed, in seconds: a third of the gap, within bounds. */
export function graceFor(schedule: string): number {
  const [minute = "", hour = ""] = schedule.trim().split(/\s+/);
  if (hour === "*") return minute.includes("*/") ? 10 * 60 : 20 * 60; // hourly
  if (hour.includes("*/") || hour.includes(",")) return 60 * 60; // every few hours
  return 2 * 60 * 60; // daily
}

/**
 * Is the job late? It was due at its last scheduled time, the grace has
 * passed, and no run started at or after that time. A job never seen running
 * is late too, once a due time and its grace have passed.
 */
export function isLate(schedule: string, lastStartedAt: Date | null, now: Date): boolean {
  if (!parseCron(schedule)) return false;
  const due = previousRun(schedule, new Date(now.getTime() - graceFor(schedule) * 1000));
  if (!due) return false;
  // Vercel starts a cron within its minute; a run that started up to a
  // minute early still counts for that slot.
  return lastStartedAt === null || lastStartedAt.getTime() < due.getTime() - MINUTE_MS;
}
