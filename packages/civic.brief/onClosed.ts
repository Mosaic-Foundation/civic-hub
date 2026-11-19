// What Briefs does when the kernel says a process closed (kernel step 3): it
// makes the pending brief for it. The kernel used to call this itself
// (src/processes/spawnBrief.ts); now Briefs listens, and the kernel names no
// package. A type that says nothing about what it came to gets no brief.

import { HubDbError, emitEvent, processesOf, results, type ClosedProcess, type Process } from "@civic-social/plugin-sdk";
import { finalizeBriefContent } from "./finalize.js";
import { emitBriefAggregationCompleted } from "./events.js";
import type { BriefProcessState } from "./models.js";

const BRIEF_TYPE = "civic.brief";
const ownProcesses = () => processesOf(BRIEF_TYPE);

/**
 * Make the pending brief for a process that just closed. Returns the brief, or
 * null when its type says nothing, or it already has one (a source has at most
 * one brief: a unique index, processes_one_brief_per_source).
 */
export async function briefOnClose(closed: ClosedProcess): Promise<Process | null> {
  const { process: source } = closed;
  if (source.definition.type === BRIEF_TYPE) return null;
  if (await ownProcesses().idWhere("source_process_id", source.id)) return null;
  const handed = await closed.result();
  if (!handed) return null;
  // What the source handed the brief to finish with the AI (a conversation's
  // result), finished under the brief's own grant, before it is written.
  const content = await finalizeBriefContent(handed);

  // Civic Activity Spec v0.2 §2.2.1: a system actor names the part that acted.
  const actor = closed.actor || "system:brief-spawn";
  let brief: Process;
  try {
    brief = await ownProcesses().create({
      definition: { type: BRIEF_TYPE, version: "0.1" },
      // Mirror the source's title; the "Brief" pill, tab and heading tell them apart.
      title: source.title,
      description: source.description,
      jurisdiction: source.jurisdiction,
      createdBy: actor,
      state: { source_process_id: source.id, source_process_type: source.definition.type, content },
    });
  } catch (err) {
    // Another close of the same source made it first: not an error.
    if (err instanceof HubDbError && err.code === "23505") return null;
    throw err;
  }

  // The source keeps what its type keeps from the written-up result (a
  // conversation, its summary), so its own page shows it whether or not this
  // brief is ever published. Best effort: the brief is made either way.
  try {
    await results.keep(source.id, content, { resultId: brief.id, at: new Date().toISOString() });
  } catch (err) {
    console.warn(`[brief] ${source.id} did not keep its written result: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // civic.process.created came with the kernel's create; this adds the
  // aggregation_completed pair (as the vote-results spawn did).
  await emitBriefAggregationCompleted(
    { process_id: brief.id, jurisdiction: brief.jurisdiction, emit: emitEvent },
    actor,
    brief.state as unknown as BriefProcessState,
  );
  return brief;
}
