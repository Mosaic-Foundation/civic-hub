// Finalize the source process when its Civic Brief is published.
//
// Injected into the brief module's approve orchestration as
// `finalizeSource`. Generic for conversation/proposal/project (mark the
// process finalized); a type can decide for itself with its handler's
// finalizeAfterBrief (civic.vote runs the vote module's finalizeVote with the
// anonymized ballots, mirroring the legacy adminVoteResultsController path so
// vote finalization stays identical).

import { getProcess, saveProcessState } from "./processService.js";
import { getProcessHandler } from "../processes/registry.js";

export async function finalizeBriefSource(
  sourceProcessId: string,
  sourceProcessType: string,
  actor: string,
): Promise<void> {
  const src = await getProcess(sourceProcessId);
  if (!src) return; // best-effort: a missing source must not fail the publish
  if (src.status === "finalized") return; // idempotent

  // A type with a finalizeAfterBrief hook decides what its source becomes
  // (a vote tallies and finalizes through its own module); the hook changes
  // the process and this saves it.
  const handler = getProcessHandler(sourceProcessType);
  if (handler?.finalizeAfterBrief) {
    await handler.finalizeAfterBrief(src, actor);
    await saveProcessState(src);
    return;
  }

  // Generic: conversation / proposal / project simply become finalized.
  src.status = "finalized";
  await saveProcessState(src);
}
