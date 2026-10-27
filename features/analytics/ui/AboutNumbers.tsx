// "This hub in numbers" on the About page (ADR-016): this month's and all-time
// counts, when the hub's admin turned Public numbers on. The same numbers
// /analytics serves anyone, small ones as "fewer than 5". Nothing otherwise.

import { useApi } from "../../../ui/src/hooks/useApi";
import { useHub } from "../../../ui/src/config/hub";
import type { Count } from "../types";
import { getPublicActivity } from "./api";
import "./activity.css";

const show = (v: Count) => (typeof v === "number" ? v.toLocaleString() : v);

export default function AboutNumbers() {
  const hub = useHub();
  const on = hub.plugins.enabled("analytics") && hub.setting("plugin.analytics.public_numbers") === "true";
  const month = useApi(on ? "analytics/public/month" : null, () => getPublicActivity("month"), { cache: true });
  const all = useApi(on ? "analytics/public/all" : null, () => getPublicActivity("all"), { cache: true });
  if (!on || !month.data || !all.data) return null;
  const rows: Array<[string, Count, Count]> = [
    ["Residents who took part", month.data.totals.active_residents, all.data.totals.active_residents],
    ["Times they took part", month.data.totals.participations, all.data.totals.participations],
    ["Processes started", month.data.totals.processes_created, all.data.totals.processes_created],
    ["Results and briefs", month.data.totals.outcomes, all.data.totals.outcomes],
  ];
  return (
    <section className="about-numbers" aria-labelledby="about-numbers" data-testid="about-numbers">
      <h2 id="about-numbers">This hub in numbers</h2>
      <table className="activity-table">
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">What</span></th>
            <th scope="col">{month.data.period.label}</th>
            <th scope="col">{all.data.period.label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, m, a]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{show(m)}</td>
              <td>{show(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="form-hint">
        Counted from this hub's public record. No number names anyone; from 1 to 4 reads "fewer than 5". The same
        numbers, with how each is counted, are at <a href="/api/analytics">/analytics</a>.
      </p>
    </section>
  );
}
