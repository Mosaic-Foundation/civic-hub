// The analytics job (ADR-016): per hub, hourly.
//
//   1. Days: event_counts_by_day from the day before the last one rolled up
//      (the whole log on a first run) to today, upserted into
//      analytics_daily; a day's rows the read no longer returns are deleted.
//   2. Periods: for each kind, the current period and the one before it
//      (every period since the first event on a first run): the counts of
//      distinct residents from event_actor_counts, upserted into
//      analytics_period; a measure the read no longer returns is deleted.
//
// Idempotent: a second run over the same log writes the same rows. Only
// counts are stored: event_actor_counts builds its sets of accounts inside
// one statement and returns numbers.

import { readAll, resolveTimeZone, getSettingSync, KEYS, type FeatureHost } from "../../src/sdk/index.js";
import { buildPlan } from "./plan.js";
import { PERIOD_KINDS, addDays, periodOf, periodsBetween, previousPeriod, todayIn, type Period } from "./periods.js";

/** Before any hub's first event: a first run reads the whole log. */
const BEGINNING = "2000-01-01";

export interface RollupResult {
  days: { from: string; to: string; rows: number; removed: number };
  periods: number;
  launch: string | null;
}

export function hubTimeZone(): string {
  return resolveTimeZone(getSettingSync(KEYS.IDENTITY_TIMEZONE));
}

/** The hub's first rolled-up day: when "since launch" begins. */
export async function launchDay(host: FeatureHost): Promise<string | null> {
  const first = await host.db().from("analytics_daily").select<{ day: string }>("day").order("day", { ascending: true }).limit(1);
  return first[0]?.day ?? null;
}

const key = (r: { day: string; process_type: string; event_type: string }) => `${r.day}|${r.process_type}|${r.event_type}`;

async function rollDays(host: FeatureHost, tz: string, today: string, full: boolean): Promise<RollupResult["days"]> {
  const db = host.db();
  const last = full ? [] : await db.from("analytics_daily").select<{ day: string }>("day").order("day", { ascending: false }).limit(1);
  const from = last[0] ? addDays(last[0].day, -1) : BEGINNING;
  const counted = await host.eventLog().countByDay(tz, from, today);
  if (counted.length > 0) {
    for (let i = 0; i < counted.length; i += 500) {
      await db.from("analytics_daily").upsert(counted.slice(i, i + 500), { onConflict: "hub_id,day,process_type,event_type" });
    }
  }
  const stored = await readAll<{ day: string; process_type: string; event_type: string }>((a, b) =>
    db
      .from("analytics_daily")
      .select<{ day: string; process_type: string; event_type: string }>("day, process_type, event_type")
      .gte("day", from)
      .lte("day", today)
      .order("day")
      .order("process_type")
      .order("event_type")
      .range(a, b),
  );
  const keep = new Set(counted.map(key));
  let removed = 0;
  for (const r of stored) {
    if (keep.has(key(r))) continue;
    await db.from("analytics_daily").delete().eq("day", r.day).eq("process_type", r.process_type).eq("event_type", r.event_type);
    removed++;
  }
  return { from, to: today, rows: counted.length, removed };
}

async function rollPeriod(host: FeatureHost, tz: string, p: Period, today: string, launch: string): Promise<void> {
  const db = host.db();
  const end = p.end < today ? p.end : today;
  const prev = previousPeriod(p, launch);
  const counts = await host.eventLog().countActors(
    tz,
    { from: p.start, to: end, prevFrom: prev?.start ?? null, prevTo: prev?.end ?? null },
    buildPlan(host.eventLog().types()),
  );
  const computedAt = new Date().toISOString();
  if (counts.length > 0) {
    await db.from("analytics_period").upsert(
      counts.map((c) => ({ period_kind: p.kind, period_start: p.start, period_end: end, measure: c.measure, value: c.value, computed_at: computedAt })),
      { onConflict: "hub_id,period_kind,period_start,measure" },
    );
  }
  const stored = await db
    .from("analytics_period")
    .select<{ measure: string }>("measure")
    .eq("period_kind", p.kind)
    .eq("period_start", p.start)
    .limit(500);
  const keep = new Set(counts.map((c) => c.measure));
  for (const r of stored) {
    if (!keep.has(r.measure)) await db.from("analytics_period").delete().eq("period_kind", p.kind).eq("period_start", p.start).eq("measure", r.measure);
  }
}

/** One hub's rollup. `full` recomputes every day and every period. */
export async function rollup(host: FeatureHost, now: Date, opts: { full?: boolean } = {}): Promise<RollupResult> {
  const tz = hubTimeZone();
  const today = todayIn(tz, now);
  const days = await rollDays(host, tz, today, opts.full ?? false);
  const launch = await launchDay(host);
  if (!launch) return { days, periods: 0, launch: null };

  const any = opts.full ? 0 : await host.db().from("analytics_period").count();
  const periods: Period[] = [];
  for (const kind of PERIOD_KINDS) {
    if (kind === "all") {
      periods.push(periodOf("all", today, launch));
    } else if (any === 0) {
      periods.push(...periodsBetween(kind, launch, today));
    } else {
      const current = periodOf(kind, today, launch);
      const prev = previousPeriod(current, launch);
      if (prev && prev.end >= launch) periods.push(prev);
      periods.push(current);
    }
  }
  // "all" moves its start when the first day changes; drop a stale one.
  await host.db().from("analytics_period").delete().eq("period_kind", "all").neq("period_start", launch);
  for (const p of periods) await rollPeriod(host, tz, p, today, launch);
  return { days, periods: periods.length, launch };
}
