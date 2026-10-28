// Universal brief spawn — the single seam every closing process routes
// through to produce its Civic Brief.
//
// When a process closes, its handler's `generateBrief` produces the
// type-specific BriefContent; this helper wraps it in a civic.brief
// process row (pending admin review). A type that doesn't implement
// generateBrief (or returns null) simply closes without a brief — the
// call is a no-op, so wiring it into a close path is always safe.

import { closedEarlyView } from "../services/closeEarly.js";
import { isPluginEnabledSync } from "../services/hubSettings.js";
import { Process } from "../models/process.js";
import { getProcessFactory, getProcessHandler } from "./registry.js";
import { emitEvent } from "../events/eventEmitter.js";
import { HubDbError } from "../db/forHub.js";
import { briefIdForSource } from "../services/processRows.js";
import type { BriefProcessState } from "../../packages/civic.brief/api.js";

/**
 * Spawn a pending civic.brief from a just-closed source process. Returns
 * the created brief process, or null when the source type produces no
 * brief. Best-effort by contract: callers should not let a brief failure
 * block the source's close (wrap in try/catch at the call site, mirroring
 * the vote-results spawn guard).
 */
export async function spawnBriefFromClosedProcess(
  source: Process,
  // Civic Activity Spec v0.2 §2.2.1: a system actor MUST name the specific
  // component that acted, so an audit trail can tell hub machinery apart. The
  // "system:" prefix is what the activity serializer maps to a space-scoped
  // system IRI (a bare name would serialize as a participant).
  actor: string = "system:brief-spawn",
): Promise<Process | null> {
  const sourceType = source.definition.type;
  const handler = getProcessHandler(sourceType);
  if (!handler?.generateBrief) return null;
  // A hub with briefs switched off closes the source without one — the
  // source's own close must not fail because a plugin is off.
  if (!isPluginEnabledSync("brief")) return null;

  const handed = await handler.generateBrief(source);
  if (!handed) return null;
  // What the source handed the brief to finish with the AI (a conversation's
  // result), finished by the brief under its own grant, before it is written.
  // Loaded on first use, never as the engine starts (engine 2, ADR-017).
  const { finalizeBriefContent } = await import("../../packages/civic.brief/api.js");
  const content = await finalizeBriefContent(handed);
  // Closed early: every brief carries the line and the admin's note, whatever
  // its type (src/services/closeEarly.ts).
  const early = closedEarlyView(source.state);
  if (early) content.closed_early = { line: early.line, note: early.note };

  const factory = getProcessFactory();
  // Insert-or-skip: a source has at most one brief, enforced by a unique
  // index (processes_one_brief_per_source). A second spawn for the same
  // source is refused before anything is written, and is not an error.
  let brief: Process;
  try {
    brief = await factory({
      definition: { type: "civic.brief", version: "0.1" },
      // Mirror the source's title; the "Brief" pill/tab/heading disambiguate.
      title: source.title,
      description: source.description,
      jurisdiction: source.jurisdiction,
      createdBy: actor,
      state: {
        source_process_id: source.id,
        source_process_type: sourceType,
        content,
      },
    });
  } catch (err) {
    if (err instanceof HubDbError && err.code === "23505") return null;
    throw err;
  }

  // civic.process.created is already emitted by the generic factory; emit
  // only the aggregation_completed pair (mirrors the vote-results spawn).
  const briefState = brief.state as unknown as BriefProcessState;
  const { emitBriefAggregationCompleted } = await import("../../packages/civic.brief/events.js");
  await emitBriefAggregationCompleted(
    {
      process_id: brief.id,
      jurisdiction: brief.jurisdiction,
      emit: emitEvent,
    },
    actor,
    briefState,
  );

  return brief;
}

/**
 * The id of this source's brief, or null. A source has at most one (a unique
 * index); callers check first to skip generating a brief that would be
 * refused.
 */
export async function findExistingBriefId(
  sourceProcessId: string,
): Promise<string | null> {
  return briefIdForSource(sourceProcessId);
}
