// One hub's numbers for one period (ADR-016): what the Activity page, the CSV,
// /analytics, the About block, the digest line and the console all show.
// Read from the rollup tables, never the events; the same function for every
// audience, with small numbers hidden below admin.

import { readAll, hubDisplayNameSync, type FeatureHost, type ProcessTypeSummary } from "../../src/sdk/index.js";
import { MEASURES } from "../../src/shared/participation.js";
import { feeders, provenance, rolesOf } from "./plan.js";
import { hubTimeZone, launchDay } from "./rollup.js";
import { periodLabel, periodOf, previousPeriod, todayIn, type Period, type PeriodKind } from "./periods.js";

/** Below admin, a count from 1 to SMALL - 1 is shown as SMALL_LABEL. */
export const SMALL = 5;
export const SMALL_LABEL = "fewer than 5";

export type Count = number | typeof SMALL_LABEL;

export const DEFINITIONS = {
  active_residents:
    "Distinct accounts of this hub with at least one participation or creation event in the period. Admins' own acts as admins (reviews, publishing) are not participation; the system is not a resident.",
  new_residents:
    "Accounts that joined this hub in the period, counted from its membership list: the one number not read from the event log.",
  participations:
    "Participation events in the period (each act counts once), plus the participant totals recorded for processes whose participants take part outside the hub.",
  processes_created: "Processes that came into being in the period, by each type's declared creation events.",
  processes_closed: "Processes that closed in the period, by each type's declared closing events.",
  outcomes: "Results published and briefs delivered in the period, by each type's declared outcome events.",
  residents_in_more_than_one_type: "Distinct residents active on more than one type of process in the period.",
  returning_from_previous_period: "Distinct residents active in the period who were also active in the period before it.",
} as const;

export interface TypeRow {
  type: string;
  label: string;
  plural: string;
  processes_created: Count;
  processes_closed: Count;
  participations: Count;
  outcomes: Count;
  active_residents: Count;
}

export interface MeasureRow {
  id: string;
  label: string;
  residents: { label: string; value: Count };
  records: { label: string; value: Count };
  derivation: string;
  provenance: { participation: Array<{ type: string; events: string[] }>; outcome: Array<{ type: string; events: string[] }> };
}

export interface Report {
  hub: string;
  period: { kind: PeriodKind; start: string; end: string; label: string; to_date: boolean };
  previous_period: { start: string; end: string } | null;
  generated_at: string;
  /** When the counts of residents were last computed (the job runs hourly); null before its first run. */
  computed_at: string | null;
  totals: {
    new_residents: Count;
    active_residents: Count;
    processes_created: Count;
    processes_closed: Count;
    participations: Count;
    outcomes: Count;
  };
  by_type: TypeRow[];
  measures: MeasureRow[];
  retention: { residents_in_more_than_one_type: Count; returning_from_previous_period: Count };
  definitions: typeof DEFINITIONS;
  suppression: { applied: boolean; below: number; shown_as: string };
}

/** Exact for admins; below admin, 1 to 4 reads "fewer than 5". */
export function suppress(v: number, exact: boolean): Count {
  return !exact && v > 0 && v < SMALL ? SMALL_LABEL : v;
}

function sentence(template: string, prov: ReturnType<typeof provenance>): string {
  const part = (list: Array<{ label: string; events: string[] }>) =>
    list.length === 0 ? "none" : list.map((x) => `${x.label}: ${x.events.join(", ")}`).join("; ");
  return template.replace("{participation}", part(prov.participation)).replace("{outcome}", part(prov.outcome));
}

/** The period of `kind` holding `at` (default today), in the hub's time zone. */
export async function resolvePeriod(host: FeatureHost, kind: PeriodKind, at: string | null, now: Date): Promise<{ period: Period; today: string; launch: string }> {
  const today = todayIn(hubTimeZone(), now);
  const launch = (await launchDay(host)) ?? today;
  return { period: periodOf(kind, at ?? today, launch), today, launch };
}

export async function buildReport(
  host: FeatureHost,
  opts: { kind: PeriodKind; at: string | null; exact: boolean; now: Date },
): Promise<Report> {
  const { period, today, launch } = await resolvePeriod(host, opts.kind, opts.at, opts.now);
  const end = period.end < today ? period.end : today;
  const types: readonly ProcessTypeSummary[] = host.eventLog().types();
  const roleOf = rolesOf(types);
  const db = host.db();

  const days = await readAll<{ process_type: string; event_type: string; events: number }>((a, b) =>
    db
      .from("analytics_daily")
      .select<{ process_type: string; event_type: string; events: number }>("process_type, event_type, events")
      .gte("day", period.start)
      .lte("day", end)
      .order("day")
      .order("process_type")
      .order("event_type")
      .range(a, b),
  );
  const stored = await db
    .from("analytics_period")
    .select<{ measure: string; value: number; computed_at: string }>("measure, value, computed_at")
    .eq("period_kind", period.kind)
    .eq("period_start", period.start)
    .limit(500);
  const counts = new Map(stored.map((r) => [r.measure, r.value]));
  const n = (measure: string) => counts.get(measure) ?? 0;

  // Additive counts by type and role, from the days.
  const byType = new Map<string, Record<"participation" | "creation" | "closing" | "outcome", number>>();
  const roleEvents = (type: string) => {
    let r = byType.get(type);
    if (!r) byType.set(type, (r = { participation: 0, creation: 0, closing: 0, outcome: 0 }));
    return r;
  };
  for (const d of days) for (const role of roleOf(d.process_type, d.event_type)) roleEvents(d.process_type)[role] += d.events;
  for (const t of types) if (t.participation?.participation === "elsewhere") roleEvents(t.type).participation += n(`total:${t.type}`);

  const s = (v: number) => suppress(v, opts.exact);
  const sum = (role: "participation" | "creation" | "closing" | "outcome") => [...byType.values()].reduce((a, r) => a + r[role], 0);

  const by_type: TypeRow[] = types.map((t) => {
    const r = byType.get(t.type) ?? { participation: 0, creation: 0, closing: 0, outcome: 0 };
    return {
      type: t.type,
      label: t.label,
      plural: t.plural,
      processes_created: s(r.creation),
      processes_closed: s(r.closing),
      participations: s(r.participation),
      outcomes: s(r.outcome),
      active_residents: s(n(`active:${t.type}`)),
    };
  });

  const measures: MeasureRow[] = MEASURES.map((m) => {
    const viaParticipation = feeders(types, m.id, "participation");
    const viaOutcome = feeders(types, m.id, "outcome");
    let residents = 0;
    let records = 0;
    for (const t of viaParticipation) {
      if (t.participation?.participation === "elsewhere") residents += n(`total:${t.type}`);
      else records += byType.get(t.type)?.participation ?? 0;
    }
    if (viaParticipation.some((t) => Array.isArray(t.participation?.participation))) residents += n(`measure:${m.id}`);
    for (const t of viaOutcome) records += byType.get(t.type)?.outcome ?? 0;
    if (viaOutcome.some((t) => t.participation?.sourceField)) residents += n(`source:${m.id}`);
    const prov = provenance(types, m.id);
    return {
      id: m.id,
      label: m.label,
      residents: { label: m.residents, value: s(residents) },
      records: { label: m.records, value: s(records) },
      derivation: `${sentence(m.derivation, prov)} Period: ${period.start} to ${end}.`,
      provenance: {
        participation: prov.participation.map((x) => ({ type: x.type, events: x.events })),
        outcome: prov.outcome.map((x) => ({ type: x.type, events: x.events })),
      },
    };
  });

  const prev = previousPeriod(period, launch);
  const computedAt = stored.reduce<string | null>((a, r) => (a && a > r.computed_at ? a : r.computed_at), null);
  return {
    hub: hubDisplayNameSync(),
    period: { kind: period.kind, start: period.start, end, label: periodLabel(period), to_date: period.end >= today },
    previous_period: prev ? { start: prev.start, end: prev.end } : null,
    generated_at: opts.now.toISOString(),
    computed_at: computedAt,
    totals: {
      new_residents: s(n("new_residents")),
      active_residents: s(n("active")),
      processes_created: s(sum("creation")),
      processes_closed: s(sum("closing")),
      participations: s(sum("participation")),
      outcomes: s(sum("outcome")),
    },
    by_type,
    measures,
    retention: {
      residents_in_more_than_one_type: s(n("multi_type")),
      returning_from_previous_period: s(prev ? n("returning") : 0),
    },
    definitions: DEFINITIONS,
    suppression: { applied: !opts.exact, below: SMALL, shown_as: SMALL_LABEL },
  };
}
