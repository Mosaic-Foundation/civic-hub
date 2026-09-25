// A hub's own clock.
//
// Scheduled jobs run on UTC (Vercel Cron has no other zone); a hub chooses
// times in its own zone. These helpers are the one place that converts, so a
// job asks "is it the hub's send hour?" rather than doing zone arithmetic.

/** Is `zone` an IANA time zone this runtime knows? */
export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** `zone` when it is a real time zone, UTC otherwise. */
export function resolveTimeZone(zone: string | null | undefined): string {
  const z = zone?.trim() ?? "";
  return isValidTimeZone(z) ? z : "UTC";
}

/** The hour of the day, 0–23, that `now` is in `zone`. */
export function hourInZone(now: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(zone),
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  // Some runtimes print midnight as 24 even with h23.
  return Number.isFinite(hour) ? hour % 24 : now.getUTCHours();
}
