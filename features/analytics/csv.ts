// The Activity page's CSV download (ADR-016): one report as rows of
// section, item, measure, value, with each funder measure's derivation.
// Counts only, as the page shows them.

import type { Report } from "./report.js";

const cell = (v: string | number) => {
  const s = String(v);
  // A leading =, +, - or @ is a formula to a spreadsheet; quote it as text.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function reportCsv(r: Report): string {
  const rows: Array<Array<string | number>> = [
    ["section", "item", "measure", "value"],
    ["period", r.period.label, "from", r.period.start],
    ["period", r.period.label, "to", r.period.end],
  ];
  for (const [k, v] of Object.entries(r.totals)) rows.push(["totals", "all types", k, v]);
  for (const t of r.by_type) {
    rows.push(
      ["by type", t.plural, "processes_created", t.processes_created],
      ["by type", t.plural, "processes_closed", t.processes_closed],
      ["by type", t.plural, "participations", t.participations],
      ["by type", t.plural, "outcomes", t.outcomes],
      ["by type", t.plural, "active_residents", t.active_residents],
    );
  }
  for (const m of r.measures) {
    rows.push(["funder measure", m.label, m.residents.label, m.residents.value]);
    rows.push(["funder measure", m.label, m.records.label, m.records.value]);
    rows.push(["funder measure", m.label, "derivation", m.derivation]);
  }
  for (const [k, v] of Object.entries(r.retention)) rows.push(["retention", "all types", k, v]);
  return `${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
}
