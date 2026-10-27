// What counts as participation (the analytics slice, 2026-10-27; ADR-016).
//
// Each process type declares, in its manifest's `participation`, which of
// the event types it emits count as a resident taking part, which bring one
// of its processes into being, which close one and which record its outcome.
// The hub's analytics (src/features/analytics/) counts every type from these
// declarations and nothing else, so a type installed tomorrow is counted the
// day it is installed, and the counting code names no type.
//
// The host declares its own events here once (comments, submissions for
// review): they count the same way for every type.
//
// The funder measures (MEASURES) are named here with the sentence that says
// how each is derived; a type says which of its roles feeds which measure.
//
// Plain data, shared with the UI: imports nothing.

/** The roles an event can play in the count. */
export type ParticipationRole = "participation" | "creation" | "closing" | "outcome";

/** The funder measures (the September note's three Bucket 1 items). */
export const MEASURE_IDS = ["met_in_public", "worked_with_neighbours", "contacted_an_official"] as const;
export type MeasureId = (typeof MEASURE_IDS)[number];

export interface ParticipationDeclaration {
  /**
   * The events that record a resident taking part, one event per act, named
   * by its actor (a ballot cast, a support given). "elsewhere": its
   * participants act outside the hub (a conversation in Polis), and the
   * number of them is the total another type records for it (`sourceTotals`).
   * "none": residents do not take part in it (a brief, an announcement).
   */
  participation: readonly string[] | "elsewhere" | "none";
  /** The events that bring one of its processes into being (one per process). */
  creation: readonly string[];
  /** The events that close one. */
  closing: readonly string[];
  /** The events that record what one produced (a result published, a brief delivered). */
  outcome: readonly string[];
  /**
   * For a type that summarizes another (a brief): the payload field of its
   * events naming the process it summarizes.
   */
  sourceField?: string;
  /**
   * Totals it records for the process it summarizes, as payload fields of
   * its own events: counted as that source's participation only when the
   * source's own participation is "elsewhere" (otherwise its residents were
   * already counted, one act at a time).
   */
  sourceTotals?: readonly { event: string; field: string }[];
  /** Which of its roles feeds which funder measure. */
  measures?: Partial<Record<MeasureId, "participation" | "outcome">>;
}

/**
 * The host's own events, counted for whatever type they happen on: a
 * comment, a submission for review and its revision are a resident taking
 * part. (Review decisions are an admin's, and are not.)
 */
export const HOST_PARTICIPATION: readonly string[] = [
  "civic.process.comment_added",
  "civic.review.submitted",
  "civic.review.revised",
];

export interface MeasureDefinition {
  id: MeasureId;
  /** The Census CPS item it stands in for. */
  label: string;
  /** What each of its two numbers is. */
  residents: string;
  records: string;
  /** How it was derived, in one sentence; {participation} and {outcome} name the event types. */
  derivation: string;
}

export const MEASURES: readonly MeasureDefinition[] = [
  {
    id: "met_in_public",
    label: "Attended a public meeting",
    residents: "Participants in public conversations (a total of each conversation's participants, not distinct people)",
    records: "Public meetings recorded",
    derivation:
      "Participants are the totals recorded for conversations whose participants take part outside the hub ({participation}); " +
      "meetings are the meeting records published ({outcome}). The hub records no attendance at meetings themselves.",
  },
  {
    id: "worked_with_neighbours",
    label: "Worked with neighbours on something",
    residents: "Residents who took part in a project",
    records: "Projects with participation",
    derivation:
      "Distinct residents with at least one participation or creation event on a project ({participation}) in the period.",
  },
  {
    id: "contacted_an_official",
    label: "Contacted an official",
    residents: "Residents whose participation went into a brief delivered to officials",
    records: "Briefs delivered to officials",
    derivation:
      "Briefs are the delivery events in the period ({outcome}); residents are the distinct people with a participation " +
      "event on the process each delivered brief summarizes, at any time before its delivery.",
  },
];

/**
 * Why a declaration is wrong, or null when it is fine. `emits` is what the
 * type emits (its descriptor's), `hostTypes` the host's lifecycle and review
 * event types (which every type emits without listing them). Pure.
 */
export function participationProblem(
  decl: unknown,
  facts: { emits: readonly string[]; hostTypes: readonly string[] },
): string | null {
  if (!decl || typeof decl !== "object") return "participation must be declared (an object)";
  const d = decl as Partial<ParticipationDeclaration>;
  const known = new Set([...facts.emits, ...facts.hostTypes]);
  const list = (name: string, v: unknown): string | null => {
    if (!Array.isArray(v)) return `participation.${name} must be a list of event types`;
    for (const t of v) {
      if (typeof t !== "string" || !known.has(t)) return `participation.${name}: ${String(t)} is not an event type it emits`;
    }
    return null;
  };
  if (d.participation !== "elsewhere" && d.participation !== "none") {
    const p = list("participation", d.participation);
    if (p) return p;
    if ((d.participation as readonly string[]).length === 0) {
      return 'participation.participation must name at least one event type, or say "elsewhere" or "none"';
    }
  }
  for (const role of ["creation", "closing", "outcome"] as const) {
    const p = list(role, d[role]);
    if (p) return p;
  }
  if (d.sourceTotals !== undefined) {
    if (typeof d.sourceField !== "string" || d.sourceField === "") return "participation.sourceTotals needs a sourceField";
    if (!Array.isArray(d.sourceTotals)) return "participation.sourceTotals must be a list";
    for (const t of d.sourceTotals) {
      if (!t || !known.has(t.event) || typeof t.field !== "string" || t.field === "") {
        return "participation.sourceTotals: each needs an event type it emits and a payload field";
      }
    }
  }
  for (const [id, role] of Object.entries(d.measures ?? {})) {
    if (!(MEASURE_IDS as readonly string[]).includes(id)) return `participation.measures: ${id} is not a measure (${MEASURE_IDS.join(", ")})`;
    if (role !== "participation" && role !== "outcome") return `participation.measures.${id} must be "participation" or "outcome"`;
    if (role === "outcome" && (d.outcome ?? []).length === 0) return `participation.measures.${id} is fed by its outcome, and it declares none`;
    if (role === "participation" && d.participation === "none") return `participation.measures.${id} is fed by participation, and it declares none`;
  }
  return null;
}
