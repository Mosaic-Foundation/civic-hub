// The results bars, one layout everywhere (Vote pages fixes, 2026-10-13):
// each option's label full width with its count at the right, "✓ Your vote"
// beside the label, the bar below at full width. The live vote panel and the
// published results page both use it, so no page has a narrow label column
// (Adam's dev walk: the live panel's labels wrapped to five or six lines).

import ResultLabel from "./ResultLabel";
import "./ResultBars.css";

export interface ResultBar {
  /** Stable key (the option id, or the option). */
  key: string;
  label: string;
  count: number;
  /** Whole percent, 0–100. */
  pct: number;
  /** This browser's own ballot, from its receipt. */
  mine: boolean;
}

export default function ResultBars({ rows }: { rows: ResultBar[] }) {
  return (
    <ul className="result-bars">
      {rows.map((r) => (
        <li key={r.key} className={`result-bar-row${r.mine ? " is-mine" : ""}`}>
          <div className="result-bar-label">
            <ResultLabel option={r.label} mine={r.mine} />
            <span className="result-bar-count">
              {r.count} ({r.pct}%)
            </span>
          </div>
          <div className="result-bar-track">
            <div className="result-bar-fill" style={{ width: `${Math.min(r.pct, 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
