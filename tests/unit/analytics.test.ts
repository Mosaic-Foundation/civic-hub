// Activity (ADR-016): calendar periods, the plan built from the declarations,
// small numbers, the CSV, and the rule that the counting code names no type
// and never reads a ballot.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { addDays, periodOf, periodsBetween, previousPeriod, todayIn, periodLabel } from "../../features/analytics/periods.js";
import { buildPlan, rolesOf } from "../../features/analytics/plan.js";
import { suppress } from "../../features/analytics/report.js";
import { reportCsv } from "../../features/analytics/csv.js";
import { PROCESS_MANIFESTS } from "../../src/shared/processManifests.js";
import { HOST_PARTICIPATION } from "../../src/shared/participation.js";
import type { ProcessTypeSummary } from "../../src/plugins/feature.js";

const ROOT = join(__dirname, "../..");

describe("periods, in the hub's calendar", () => {
  it("weeks start on Monday; months and quarters on their first day", () => {
    expect(periodOf("week", "2026-10-29", "2026-01-01")).toEqual({ kind: "week", start: "2026-10-26", end: "2026-11-01" });
    expect(periodOf("week", "2026-10-26", "2026-01-01").start).toBe("2026-10-26");
    expect(periodOf("week", "2026-11-01", "2026-01-01").start).toBe("2026-10-26");
    expect(periodOf("month", "2026-02-14", "2026-01-01")).toEqual({ kind: "month", start: "2026-02-01", end: "2026-02-28" });
    expect(periodOf("quarter", "2026-11-30", "2026-01-01")).toEqual({ kind: "quarter", start: "2026-10-01", end: "2026-12-31" });
    expect(periodOf("all", "2026-11-30", "2026-03-03")).toEqual({ kind: "all", start: "2026-03-03", end: "2026-11-30" });
  });

  it("the period before; every period since launch", () => {
    expect(previousPeriod(periodOf("quarter", "2026-01-15", "2025-01-01"), "2025-01-01")).toEqual({ kind: "quarter", start: "2025-10-01", end: "2025-12-31" });
    expect(previousPeriod(periodOf("all", "2026-01-15", "2025-01-01"), "2025-01-01")).toBeNull();
    expect(periodsBetween("month", "2026-08-11", "2026-10-27").map((p) => p.start)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(periodsBetween("week", "2026-10-20", "2026-10-27").map((p) => p.start)).toEqual(["2026-10-19", "2026-10-26"]);
  });

  it("today is the hub's own date, not UTC's", () => {
    const lateEvening = new Date("2026-10-28T02:30:00Z");
    expect(todayIn("UTC", lateEvening)).toBe("2026-10-28");
    expect(todayIn("America/New_York", lateEvening)).toBe("2026-10-27");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("labels", () => {
    expect(periodLabel(periodOf("quarter", "2026-10-27", "2026-01-01"))).toBe("Q4 2026");
    expect(periodLabel(periodOf("month", "2026-10-27", "2026-01-01"))).toBe("October 2026");
    expect(periodLabel(periodOf("week", "2026-10-27", "2026-01-01"))).toBe("Week of 26 October 2026");
  });
});

describe("the plan, from the declarations alone", () => {
  const fake: ProcessTypeSummary = {
    type: "test.made_up",
    label: "Made-up thing",
    plural: "Made-up things",
    residentCreated: false,
    participation: { participation: ["test.made_up.joined"], creation: ["test.made_up.begun"], closing: ["test.made_up.over"], outcome: [] },
  };

  it("a type nobody wrote code for is counted: its participation, never its creation when residents do not create it", () => {
    const plan = buildPlan([fake]);
    expect(plan.acts).toContainEqual({ t: "test.made_up", e: "test.made_up.joined" });
    expect(plan.acts).not.toContainEqual({ t: "test.made_up", e: "test.made_up.begun" });
    for (const e of HOST_PARTICIPATION) expect(plan.acts).toContainEqual({ t: "*", e });
    const role = rolesOf([fake]);
    expect(role("test.made_up", "test.made_up.over")).toEqual(["closing"]);
    expect(role("test.made_up", "civic.process.comment_added")).toEqual(["participation"]);
    expect(role("test.made_up", "test.made_up.nothing")).toEqual([]);
  });

  it("every shipped type is in the plan its declaration makes", () => {
    const types = PROCESS_MANIFESTS.map((m) => ({
      type: m.descriptor.type,
      label: m.descriptor.display.label,
      plural: m.descriptor.display.plural,
      residentCreated: m.descriptor.creation.resident !== null,
      participation: m.participation ?? null,
    })) as ProcessTypeSummary[];
    const plan = buildPlan(types);
    for (const t of types.filter((x) => Array.isArray(x.participation?.participation))) {
      expect(plan.acts.some((a) => a.t === t.type), t.type).toBe(true);
    }
    expect(Object.keys(plan.measures)).toContain("worked_with_neighbours");
    expect(plan.sources.map((s) => s.id)).toContain("contacted_an_official");
    expect(plan.totals.length).toBeGreaterThan(0);
  });
});

describe("small numbers", () => {
  it("below admin, 1 to 4 read 'fewer than 5'; 0 and 5 are shown; admins see every number", () => {
    expect([0, 1, 4, 5, 12].map((n) => suppress(n, false))).toEqual([0, "fewer than 5", "fewer than 5", 5, 12]);
    expect([0, 1, 4].map((n) => suppress(n, true))).toEqual([0, 1, 4]);
  });
});

describe("the CSV", () => {
  it("quotes what needs quoting and turns a formula into text", () => {
    const csv = reportCsv({
      hub: "Hub",
      period: { kind: "month", start: "2026-10-01", end: "2026-10-27", label: "October 2026", to_date: true },
      previous_period: null,
      generated_at: "",
      computed_at: null,
      live: false,
      totals: { new_residents: 1, active_residents: 2, processes_created: 3, processes_closed: 4, participations: 5, outcomes: 6 },
      by_type: [{ type: "t", label: "T", plural: "=HYPERLINK(1)", processes_created: 0, processes_closed: 0, participations: 0, outcomes: 0, active_residents: 0 }],
      measures: [],
      retention: { residents_in_more_than_one_type: 0, returning_from_previous_period: 0 },
      definitions: {} as never,
      suppression: { applied: false, below: 5, shown_as: "fewer than 5" },
    });
    expect(csv.split("\n")[0]).toBe("section,item,measure,value");
    expect(csv).toContain("by type,'=HYPERLINK(1),processes_created,0");
    expect(csv).toContain("totals,all types,active_residents,2");
  });
});

describe("the counting code names no type and never reads a ballot", () => {
  const files = [
    ...readdirSync(join(ROOT, "features/analytics"))
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => join("features/analytics", f)),
    "src/plugins/features.ts",
    "src/plugins/feature.ts",
  ];
  const typeNames = PROCESS_MANIFESTS.flatMap((m) => [m.descriptor.type, ...m.descriptor.emits]);

  it("no process type and no type's event is named in the feature or its host", () => {
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const name of typeNames) expect(text.includes(`"${name}"`), `${f} names ${name}`).toBe(false);
      expect(/["']civic\.[a-z_]+["']/.test(text), `${f} names a type`).toBe(false);
    }
  });

  it("no ballot, receipt or participation row is reached", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261027100000_analytics.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const text of [sql, ...files.map((f) => readFileSync(join(ROOT, f), "utf8"))]) {
      expect(text).not.toMatch(/vote_records|active_vote_keys|vote_participation|getBallotChoices|countVoters/);
    }
  });
});
