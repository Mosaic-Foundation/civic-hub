// The report every Activity surface reads (ADR-016): plain types, shared by
// the server (report.ts) and the UI (ui.tsx, consoleView.tsx). Imports nothing
// but the period kinds.

import type { PeriodKind } from "./periods.js";

/** A count; below admin, 1 to 4 is "fewer than 5". */
export type Count = number | "fewer than 5";

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
  /** What each total means, in a sentence. */
  definitions: Readonly<Record<string, string>>;
  suppression: { applied: boolean; below: number; shown_as: string };
}


/** The console's Activity section (console.ts). */
export interface ConsoleHubActivity {
  id: string;
  name: string;
  origin: string;
  report: Report | null;
  error?: string;
}

export interface ConsoleActivity {
  /** Each period kind's reports, so the page switches range without a reload. */
  periods: Record<PeriodKind, { hubs: ConsoleHubActivity[]; sum: Report["totals"] }>;
}
