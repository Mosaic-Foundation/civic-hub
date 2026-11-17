import { useApi } from "../hooks/useApi";
import { getBreakdowns, type Breakdown } from "../services/api";
import { Table } from "../kit";
import "./ResultsBreakdown.css";

/**
 * "Results by District" / "Who took part, by age group" (districts and
 * demographics, 2026-11-16). UNIVERSAL: mount it on any process page with
 * the process's id. Renders nothing until the process is finished, or when
 * the hub asks none of the questions. Every group under 5 people reads
 * "Fewer than 5"; nobody's own answers are ever here.
 */
export default function ResultsBreakdown({ processId }: { processId: string }) {
  const { data } = useApi(`process/${processId}/breakdowns`, () => getBreakdowns(processId));
  const tables = (data?.breakdowns ?? []).filter((b) => b.rows.some((r) => r.total !== null));
  if (tables.length === 0) return null;
  return (
    <section className="results-breakdown" aria-label="Totals by group">
      {tables.map((b) => (
        <BreakdownTable key={b.dimension} b={b} />
      ))}
      <p className="form-hint results-breakdown-note">
        From what people chose to share in About you. Groups of fewer than 5 people are hidden, along with any
        number that would reveal them.
      </p>
    </section>
  );
}

function cell(v: number | null, hidden: string) {
  return v === null ? <span className="results-breakdown-hidden">{hidden}</span> : v;
}

function BreakdownTable({ b }: { b: Breakdown }) {
  return (
    <div className="results-breakdown-table">
      <h3>{b.title}</h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">{b.group_label}</th>
            {b.columns.map((c) => (
              <th scope="col" key={c}>
                {c}
              </th>
            ))}
            <th scope="col">{b.kind === "results" ? "Votes" : "People"}</th>
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {r.cells.map((v, i) => (
                <td key={b.columns[i]}>{cell(v, b.hidden_label)}</td>
              ))}
              <td>{cell(r.total, b.hidden_label)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
