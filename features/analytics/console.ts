// The console's Activity section (ADR-016): every live hub's numbers for each
// period kind, the same report each hub's admin sees, exact (the operator is
// a platform admin), and the hubs' sum. Per-hub drill-down is the renderer's:
// each hub carries its by-type rows. Counts only.

import { isPluginEnabledSync, type FeatureConsoleSection, type FeatureHost } from "../../src/sdk/index.js";
import { PERIOD_KINDS, type PeriodKind } from "./periods.js";
import { buildReport, type Report } from "./report.js";
import type { ConsoleActivity, ConsoleHubActivity } from "./types.js";

const ZERO: Report["totals"] = { new_residents: 0, active_residents: 0, processes_created: 0, processes_closed: 0, participations: 0, outcomes: 0 };

/** Hubs read at once. */
const AT_ONCE = 5;

export function consoleSection(host: FeatureHost): FeatureConsoleSection {
  return {
    id: "activity",
    name: "Activity",
    async load({ now, hubs, inHub }): Promise<ConsoleActivity> {
      // One scope per hub, its four reports inside it.
      const byHub: Array<Record<PeriodKind, ConsoleHubActivity>> = [];
      for (let i = 0; i < hubs.length; i += AT_ONCE) {
        byHub.push(
          ...(await Promise.all(
            hubs.slice(i, i + AT_ONCE).map(async (h) => {
              const each = (report: Report | null, error?: string) =>
                Object.fromEntries(PERIOD_KINDS.map((k) => [k, { ...h, report, ...(error ? { error } : {}) }])) as Record<PeriodKind, ConsoleHubActivity>;
              try {
                return await inHub(h.id, async () => {
                  if (!isPluginEnabledSync(host.featureId)) return each(null, "Activity is switched off on this hub");
                  const out = {} as Record<PeriodKind, ConsoleHubActivity>;
                  for (const kind of PERIOD_KINDS) out[kind] = { ...h, report: await buildReport(host, { kind, at: null, exact: true, now }) };
                  return out;
                });
              } catch (err) {
                return each(null, (err as Error).message);
              }
            }),
          )),
        );
      }
      const periods = {} as ConsoleActivity["periods"];
      for (const kind of PERIOD_KINDS) {
        const rows = byHub.map((h) => h[kind]);
        const sum = { ...ZERO };
        for (const r of rows) {
          if (!r.report) continue;
          for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] = (sum[k] as number) + (r.report.totals[k] as number);
        }
        periods[kind] = { hubs: rows, sum };
      }
      return { periods };
    },
  };
}
