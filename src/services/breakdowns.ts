// Breakdowns (districts and demographics, Adam 2026-11-16): a finished
// process's totals by ONE group at a time (district, OR age group, OR race),
// never crossed.
//
//   Votes      results by group, from the ballot tags (vote_records): each
//              group's count for each choice, and its total.
//   Others     who took part, by group: the process's participants (the
//              actors of its participation events, as ADR-016 counts them)
//              joined to their CURRENT About-you answers at report time.
//
// THE PROMISE: no table lets anyone work out one person's answer or vote.
//   - Any cell under 5 people reads "Fewer than 5" (null here), zero
//     included, so a group where everyone chose alike does not say so.
//   - Secondary suppression: no row and no column is left with exactly one
//     hidden cell, so a hidden number can't be worked out from a total that
//     is shown (each row's total, each choice's overall total).
//   - Nothing when the hub asks none of the questions, or the process is not
//     finished (a vote's tally must not leak while it is open).
// Internal to the hub (Adam, 2026-11-17: not in the plugin SDK): the hub
// itself puts these tables on process pages and in briefs. No one's answers
// ever leave civic.about.

import { getManifest } from "../processes/registry.js";
import { getEnabledProcess, isProcessHistoryServable, asRead, isTerminalStatus } from "./processService.js";
import { getEventsByProcessId } from "../events/eventStore.js";
import { HOST_PARTICIPATION } from "../shared/participation.js";
import { getBallotTagsForProcess } from "../modules/civic.receipts/index.js";
import { currentAboutConfig, tagsForMembers, type MemberTags } from "../modules/civic.about/index.js";
import {
  AGE_BRACKETS,
  AGE_BRACKET_LABELS,
  RACE_OPTIONS,
  type AboutConfig,
} from "../shared/aboutYou.js";
import type { Process } from "../models/process.js";

/** Groups of fewer than this many people are hidden. */
export const SMALLEST_SHOWN = 5;
export const HIDDEN_LABEL = "Fewer than 5";
export const NOT_PROVIDED_LABEL = "Not provided";

export const BREAKDOWN_DIMENSIONS = ["district", "age", "race"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export interface BreakdownRow {
  /** The group's id: a district id, an age bracket, a race id, or "not_provided". */
  key: string;
  label: string;
  /** One per column; null: fewer than 5 (hidden). Empty for a "participants" table. */
  cells: Array<number | null>;
  /** The group's total; null: hidden. */
  total: number | null;
}

/** One table: a process's totals by one group. */
export interface Breakdown {
  process_id: string;
  dimension: BreakdownDimension;
  /** "results": a vote's choices by group. "participants": how many took part, by group. */
  kind: "results" | "participants";
  /** "Results by District", "Who took part, by age group". */
  title: string;
  /** What a row is: the hub's district term, "Age group", "Race or ethnicity". */
  group_label: string;
  /** The choices (results); empty for participants. */
  columns: string[];
  rows: BreakdownRow[];
  /** What a hidden cell says. */
  hidden_label: string;
}

// --- Suppression (pure) ---------------------------------------------------------

/**
 * Hide every value under `min`, then hide more until no row and no column
 * has exactly one hidden value (so none can be worked out by subtraction
 * from a total that is shown). `matrix[r][c]`; the caller includes a row's
 * total as its last column. Pure: tested in tests/unit/breakdowns.test.ts.
 */
export function suppress(matrix: number[][], min = SMALLEST_SHOWN): Array<Array<number | null>> {
  const hidden = matrix.map((row) => row.map((v) => v < min));
  const rows = matrix.length;
  const cols = rows ? matrix[0]!.length : 0;
  const hideSmallest = (cells: Array<[number, number]>) => {
    let best: [number, number] | null = null;
    for (const [r, c] of cells) {
      if (hidden[r]![c]) continue;
      if (!best || matrix[r]![c]! < matrix[best[0]]![best[1]]!) best = [r, c];
    }
    if (best) {
      hidden[best[0]]![best[1]] = true;
      return true;
    }
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      const line: Array<[number, number]> = Array.from({ length: cols }, (_, c) => [r, c]);
      if (cols > 1 && line.filter(([a, b]) => hidden[a]![b]).length === 1) changed = hideSmallest(line) || changed;
    }
    for (let c = 0; c < cols; c++) {
      const line: Array<[number, number]> = Array.from({ length: rows }, (_, r) => [r, c]);
      if (rows > 1 && line.filter(([a, b]) => hidden[a]![b]).length === 1) changed = hideSmallest(line) || changed;
    }
  }
  return matrix.map((row, r) => row.map((v, c) => (hidden[r]![c] ? null : v)));
}

// --- Groups ------------------------------------------------------------------------

interface Group {
  key: string;
  label: string;
}

function groupsFor(dimension: BreakdownDimension, config: AboutConfig): Group[] {
  const listed: Group[] =
    dimension === "district"
      ? config.districts.map((d) => ({ key: d.id, label: d.name }))
      : dimension === "age"
        ? AGE_BRACKETS.map((b) => ({ key: b, label: AGE_BRACKET_LABELS[b] }))
        : RACE_OPTIONS.map((r) => ({ key: r.id, label: r.label }));
  return [...listed, { key: "not_provided", label: NOT_PROVIDED_LABEL }];
}

/** The groups one person or ballot counts in, for a dimension. Race may be several. */
function keysOf(tags: { district_id: string | null; age_bracket: string | null; race: string[] | null }, dimension: BreakdownDimension, groups: Group[]): string[] {
  const known = (k: string | null | undefined) => (k && groups.some((g) => g.key === k) ? k : "not_provided");
  if (dimension === "district") return [known(tags.district_id)];
  if (dimension === "age") return [known(tags.age_bracket)];
  const race = (tags.race ?? []).filter((r) => groups.some((g) => g.key === r));
  return race.length ? race : ["not_provided"];
}

function isOn(dimension: BreakdownDimension, config: AboutConfig): boolean {
  return dimension === "district" ? config.questions.district : dimension === "age" ? config.questions.birth_year : config.questions.race;
}

function titleFor(kind: Breakdown["kind"], dimension: BreakdownDimension, config: AboutConfig): { title: string; group: string } {
  const group = dimension === "district" ? config.term.singular : dimension === "age" ? "Age group" : "Race or ethnicity";
  const lower = dimension === "district" ? config.term.singular.toLowerCase() : group.toLowerCase();
  return { title: kind === "results" ? `Results by ${lower}` : `Who took part, by ${lower}`, group };
}

/** A ballot's choices: one, or each selection of an approval ballot (stored as a JSON list). */
function choicesOf(choice: string): string[] {
  if (choice.startsWith("[")) {
    try {
      const parsed = JSON.parse(choice) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed as string[];
    } catch {
      // A plain choice that starts with "[".
    }
  }
  return [choice];
}

function optionOrder(process: Process, seen: Set<string>): string[] {
  const options = (process.state as { options?: unknown }).options;
  const listed = Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
  return [...listed, ...[...seen].filter((c) => !listed.includes(c)).sort()];
}

// --- Building tables -----------------------------------------------------------------

function resultsTable(
  process: Process,
  dimension: BreakdownDimension,
  config: AboutConfig,
  ballots: Array<{ choice: string; district_id: string | null; age_bracket: string | null; race: string[] | null }>,
): Breakdown {
  const groups = groupsFor(dimension, config);
  const seen = new Set<string>();
  for (const b of ballots) for (const c of choicesOf(b.choice)) seen.add(c);
  const columns = optionOrder(process, seen);
  // matrix[group][choice...], then the group's ballots as the last column.
  const matrix = groups.map(() => new Array<number>(columns.length + 1).fill(0));
  for (const b of ballots) {
    for (const key of keysOf(b, dimension, groups)) {
      const r = groups.findIndex((g) => g.key === key);
      for (const c of choicesOf(b.choice)) matrix[r]![columns.indexOf(c)]! += 1;
      matrix[r]![columns.length]! += 1;
    }
  }
  const shown = suppress(matrix);
  const { title, group } = titleFor("results", dimension, config);
  return {
    process_id: process.id,
    dimension,
    kind: "results",
    title,
    group_label: group,
    columns,
    rows: groups.map((g, r) => ({ key: g.key, label: g.label, cells: shown[r]!.slice(0, columns.length), total: shown[r]![columns.length]! })),
    hidden_label: HIDDEN_LABEL,
  };
}

function participantsTable(process: Process, dimension: BreakdownDimension, config: AboutConfig, people: MemberTags[]): Breakdown {
  const groups = groupsFor(dimension, config);
  const matrix = groups.map(() => [0]);
  for (const p of people) for (const key of keysOf(p, dimension, groups)) matrix[groups.findIndex((g) => g.key === key)]![0]! += 1;
  const shown = suppress(matrix);
  const { title, group } = titleFor("participants", dimension, config);
  return {
    process_id: process.id,
    dimension,
    kind: "participants",
    title,
    group_label: group,
    columns: [],
    rows: groups.map((g, r) => ({ key: g.key, label: g.label, cells: [], total: shown[r]![0]! })),
    hidden_label: HIDDEN_LABEL,
  };
}

/** The people who took part in a process: the actors of its participation events (ADR-016), once each. */
async function participantIds(process: Process): Promise<string[]> {
  const declared = getManifest(process.definition.type)?.participation?.participation;
  const types = [...(Array.isArray(declared) ? declared : []), ...HOST_PARTICIPATION];
  const events = await getEventsByProcessId(process.id, types);
  const ids = new Set<string>();
  for (const e of events) {
    const actor = typeof e.actor === "string" ? e.actor : null;
    if (actor && !actor.startsWith("system:")) ids.add(actor);
  }
  return [...ids];
}

// --- The service -----------------------------------------------------------------------

/**
 * A finished process's tables, one per question the hub asks, in the order
 * district, age group, race. Empty when the hub asks nothing, the process is
 * not finished, not shown to the public, or nobody took part.
 */
export async function breakdownsFor(processId: string): Promise<Breakdown[]> {
  const config = currentAboutConfig();
  const dimensions = BREAKDOWN_DIMENSIONS.filter((d) => isOn(d, config));
  if (dimensions.length === 0) return [];
  const stored = await getEnabledProcess(processId);
  if (!stored || !(await isProcessHistoryServable(processId, { hubSurface: true }))) return [];
  const process = await asRead(stored);
  if (!isTerminalStatus(process.status)) return [];
  return tablesFor(process, dimensions, config);
}

/**
 * The tables for a process its caller knows has just closed (the brief's
 * spawn, the result of src/services/processClosed.ts), without reading it back.
 */
export async function breakdownsForClosed(process: Process): Promise<Breakdown[]> {
  const config = currentAboutConfig();
  const dimensions = BREAKDOWN_DIMENSIONS.filter((d) => isOn(d, config));
  return dimensions.length ? tablesFor(process, dimensions, config) : [];
}

async function tablesFor(process: Process, dimensions: BreakdownDimension[], config: AboutConfig): Promise<Breakdown[]> {
  const processId = process.id;
  const ballots = await getBallotTagsForProcess(processId);
  if (ballots.length > 0) return dimensions.map((d) => resultsTable(process, d, config, ballots));

  // "none": nobody takes part. "elsewhere": people take part outside the hub
  // (a conversation in Polis), so the hub's events would undercount them and
  // a table would mislead.
  const declared = getManifest(process.definition.type)?.participation?.participation;
  if (declared === "none" || declared === "elsewhere") return [];
  const people = await tagsForMembers(await participantIds(process));
  if (people.length === 0) return [];
  return dimensions.map((d) => participantsTable(process, d, config, people));
}

/** One table, by one group; null when there is none (see breakdownsFor). */
export async function breakdownFor(processId: string, dimension: BreakdownDimension): Promise<Breakdown | null> {
  return (await breakdownsFor(processId)).find((b) => b.dimension === dimension) ?? null;
}

/** A table as plain text, for a brief's section and its email: one line per group. */
export function breakdownAsText(b: Breakdown): string {
  return b.rows
    .map((row) => {
      const total = row.total === null ? b.hidden_label : String(row.total);
      if (b.kind === "participants") return `${row.label}: ${total}`;
      if (row.total === null && row.cells.every((c) => c === null)) return `${row.label}: ${b.hidden_label}`;
      const parts = b.columns.map((c, i) => `${c} ${row.cells[i] === null ? b.hidden_label.toLowerCase() : row.cells[i]}`);
      return `${row.label}: ${parts.join(", ")} (${total} in all)`;
    })
    .join("\n");
}
