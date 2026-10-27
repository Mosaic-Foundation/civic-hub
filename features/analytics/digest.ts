// The admin digest's Activity line (ADR-016): on the first digest of a month
// (the hub's own calendar), last month's numbers in one sentence. Other days,
// nothing.

import type { FeatureDigestLine, FeatureHost } from "../../src/sdk/index.js";
import { addDays, todayIn } from "./periods.js";
import { buildReport } from "./report.js";
import { hubTimeZone } from "./rollup.js";

export function digestLine(host: FeatureHost): FeatureDigestLine {
  return async ({ now }) => {
    const today = todayIn(hubTimeZone(), now);
    if (!today.endsWith("-01")) return null;
    const r = await buildReport(host, { kind: "month", at: addDays(today, -1), exact: true, now });
    const t = r.totals;
    return (
      `Activity in ${r.period.label}: ${t.active_residents} active residents, ${t.new_residents} new, ` +
      `${t.participations} participations, ${t.processes_created} processes created and ${t.processes_closed} closed. ` +
      "The Activity page has the breakdown."
    );
  };
}
