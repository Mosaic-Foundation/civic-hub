// The console's Activity tab (ADR-016; console.ts serves its data): every live
// hub's numbers for a period, the sum across hubs, and each hub's breakdown
// by kind on a click. Counts only.

import { Fragment, useState } from "react";
import type { SectionView, SectionSummary } from "../../ui/src/console/dashboardSections";
import type { PeriodKind } from "./periods";
import type { ConsoleActivity, Count } from "./types";

const KINDS: Array<{ id: PeriodKind; label: string }> = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "all", label: "Since launch" },
];

const COLUMNS = [
  ["active_residents", "Active"],
  ["new_residents", "New"],
  ["participations", "Participations"],
  ["processes_created", "Created"],
  ["processes_closed", "Closed"],
  ["outcomes", "Results and briefs"],
] as const;

const show = (v: Count | undefined) => (v === undefined ? "—" : typeof v === "number" ? v.toLocaleString() : v);

function ActivityView({ data }: { data: unknown }) {
  const { periods } = data as ConsoleActivity;
  const [kind, setKind] = useState<PeriodKind>("month");
  const [open, setOpen] = useState<string | null>(null);
  const { hubs, sum } = periods[kind];
  return (
    <>
      <div className="cx-dash-toolbar">
        <div className="cx-dash-chips" role="group" aria-label="Period">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="cx-dash-chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <div className="cx-table-wrap">
      <table className="cx-table" data-testid="dash-activity">
        <thead>
          <tr>
            <th scope="col">Hub</th>
            {COLUMNS.map(([, label]) => (
              <th scope="col" key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hubs.map((h) => (
            <Fragment key={h.id}>
              <tr data-testid={`dash-activity-${h.id}`}>
                <th scope="row">
                  {h.report ? (
                    <button type="button" className="cx-linkbtn" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                      {h.name}
                    </button>
                  ) : (
                    <span title={h.error}>{h.name}</span>
                  )}
                </th>
                {COLUMNS.map(([key]) => (
                  <td key={key}>{h.report ? show(h.report.totals[key]) : "—"}</td>
                ))}
              </tr>
              {open === h.id && h.report && (
                <tr className="cx-dash-drill">
                  <td colSpan={COLUMNS.length + 1}>
                    <p className="cx-small">
                      {h.report.period.label}. <a href={`${h.origin}/admin/activity`} target="_blank" rel="noreferrer">The hub's Activity page</a>
                    </p>
                    <table className="cx-table" data-testid={`dash-activity-types-${h.id}`}>
                      <thead>
                        <tr>
                          <th scope="col">Kind</th>
                          <th scope="col">Active</th>
                          <th scope="col">Participations</th>
                          <th scope="col">Created</th>
                          <th scope="col">Closed</th>
                          <th scope="col">Results and briefs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {h.report.by_type.map((t) => (
                          <tr key={t.type}>
                            <th scope="row">{t.plural}</th>
                            <td>{show(t.active_residents)}</td>
                            <td>{show(t.participations)}</td>
                            <td>{show(t.processes_created)}</td>
                            <td>{show(t.processes_closed)}</td>
                            <td>{show(t.outcomes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All hubs</th>
            {COLUMNS.map(([key]) => (
              <td key={key}>{show(sum[key])}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      </div>
      <p className="cx-small">
        Active residents are counted per hub, so a person active on two hubs counts on each. Counts only: nothing here
        names anyone.
      </p>
    </>
  );
}

function summarizeActivity(data: unknown): SectionSummary {
  const { periods } = data as ConsoleActivity;
  const month = periods.month;
  const off = month.hubs.filter((h) => !h.report);
  return {
    tone: "quiet",
    value: show(month.sum.active_residents),
    label: "active residents this month",
    detail: `${show(month.sum.participations)} participations across ${month.hubs.length - off.length} ${month.hubs.length - off.length === 1 ? "hub" : "hubs"}`,
    concerns: [],
  };
}

export const ANALYTICS_CONSOLE_VIEWS: Record<string, SectionView> = {
  activity: { tab: "Activity", summarize: summarizeActivity, render: ActivityView },
};
