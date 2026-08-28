// statusDisplay — THE lifecycle-status pill vocabulary (2026-08-28).
//
// Before this module, every card type mapped status → label on its own
// and had drifted: votes said "active/closed/finalized", proposals said
// "open" (and "promoted"), projects said "active/archived",
// conversations said "Completed". One process state, four dialects.
//
// The rule (Adam): a running process is "Active" and a finished one is
// "Completed", for every type. States that carry MORE information than
// active/completed keep their specific label ("Gathering support",
// "Ready to activate", "Promoted", "Archived", "Draft") — those aren't
// drift, they're meaning.
//
// Three visual variants, matching the neutral-pill-with-dot styling in
// App.css: status-live (green dot — a green light), status-phase (amber
// dot — gathering support), status-done (gray dot — finished; never
// red, a finished process is not an error).
//
// Callers pass the RAW status string. Where the same raw value means
// different things per type (a civic.proposal's "closed" means it was
// promoted to a vote; a vote's "closed" means it completed), the CALLER
// pre-translates to the semantic key ("promoted") — this module maps
// keys to presentation, it does not know process types.

export interface StatusDisplay {
  label: string;
  /** Full className for the <span>, including status-badge. */
  className: string;
}

type Variant = "live" | "phase" | "done";

const DISPLAY: Record<string, { label: string; variant: Variant }> = {
  // Running — the green light.
  active: { label: "Active", variant: "live" },
  open: { label: "Active", variant: "live" },

  // Support-gathering phases — specific labels, amber dot.
  proposed: { label: "Gathering support", variant: "phase" },
  submitted: { label: "Gathering support", variant: "phase" },
  gathering: { label: "Gathering support", variant: "phase" },
  threshold_met: { label: "Ready to activate", variant: "phase" },
  endorsed: { label: "Endorsed", variant: "phase" },

  // Finished — gray dot.
  closed: { label: "Completed", variant: "done" },
  finalized: { label: "Completed", variant: "done" },
  completed: { label: "Completed", variant: "done" },
  promoted: { label: "Promoted to a vote", variant: "done" },
  converted: { label: "Promoted to a vote", variant: "done" },
  archived: { label: "Archived", variant: "done" },
  draft: { label: "Draft", variant: "done" },
};

export function statusDisplay(status: string): StatusDisplay {
  const entry = DISPLAY[status] ?? { label: status, variant: "done" as const };
  return {
    label: entry.label,
    className: `status-badge status-${entry.variant}`,
  };
}
