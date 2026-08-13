// Universal brief spawn — the single seam every closing process routes
// through to produce its Civic Brief.
//
// When a process closes, its handler's `generateBrief` produces the
// type-specific BriefContent; this helper wraps it in a civic.brief
// process row (pending admin review). A type that doesn't implement
// generateBrief (or returns null) simply closes without a brief — the
// call is a no-op, so wiring it into a close path is always safe.

import { Process } from "../models/process.js";
import { getProcessFactory, getProcessHandler } from "./registry.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getDb } from "../db/client.js";
import { emitBriefAggregationCompleted } from "../modules/civic.brief/events.js";
import type { BriefProcessState } from "../modules/civic.brief/index.js";

/**
 * Spawn a pending civic.brief from a just-closed source process. Returns
 * the created brief process, or null when the source type produces no
 * brief. Best-effort by contract: callers should not let a brief failure
 * block the source's close (wrap in try/catch at the call site, mirroring
 * the vote-results spawn guard).
 */
export async function spawnBriefFromClosedProcess(
  source: Process,
  actor: string = "system",
): Promise<Process | null> {
  const sourceType = source.definition.type;
  const handler = getProcessHandler(sourceType);
  if (!handler?.generateBrief) return null;

  const content = await handler.generateBrief(source);
  if (!content) return null;

  const factory = getProcessFactory();
  const brief = await factory({
    definition: { type: "civic.brief", version: "0.1" },
    // Mirror the source's title; the "Brief" pill/tab/heading disambiguate.
    title: source.title,
    description: source.description,
    hubId: source.hubId,
    jurisdiction: source.jurisdiction,
    createdBy: actor,
    state: {
      source_process_id: source.id,
      source_process_type: sourceType,
      content,
    },
  });

  // civic.process.created is already emitted by the generic factory; emit
  // only the aggregation_completed pair (mirrors the vote-results spawn).
  const briefState = brief.state as unknown as BriefProcessState;
  await emitBriefAggregationCompleted(
    {
      process_id: brief.id,
      hub_id: brief.hubId,
      jurisdiction: brief.jurisdiction,
      emit: emitEvent,
    },
    actor,
    briefState,
  );

  return brief;
}

/**
 * Guard against duplicate briefs — a process should have at most one brief.
 * Returns the id of an existing civic.brief for this source, or null.
 * Callers spawn only when this returns null, mirroring the idempotent
 * vote-results spawn (collapses the common double-close window; not a full
 * mutex).
 */
export async function findExistingBriefId(
  sourceProcessId: string,
): Promise<string | null> {
  const { data } = await getDb()
    .from("processes")
    .select("id")
    .eq("type", "civic.brief")
    .eq("state->>source_process_id", sourceProcessId)
    .maybeSingle();
  return data?.id ?? null;
}
