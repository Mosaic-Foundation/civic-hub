// Finalize the source process when its Civic Brief is published.
//
// Injected into the brief module's approve orchestration as
// `finalizeSource`. Generic for conversation/proposal/project (mark the
// process finalized); vote-aware for civic.vote (run the vote module's
// finalizeVote with the anonymized ballots, mirroring the legacy
// adminVoteResultsController path so vote finalization stays identical).

import { emitEvent } from "../events/eventEmitter.js";
import { getProcess, saveProcessState } from "./processService.js";
import {
  finalizeVote,
  getVotingMethod,
  DEFAULT_METHOD,
  type VoteProcessState,
} from "../modules/civic.vote/index.js";
import { getBallotChoicesForProcess } from "../modules/civic.receipts/index.js";

export async function finalizeBriefSource(
  sourceProcessId: string,
  sourceProcessType: string,
  actor: string,
): Promise<void> {
  const src = await getProcess(sourceProcessId);
  if (!src) return; // best-effort: a missing source must not fail the publish
  if (src.status === "finalized") return; // idempotent

  if (sourceProcessType === "civic.vote") {
    // Finalize the vote through its own module so tallying/receipts behave
    // exactly as before. Ballots come from the anonymized receipts table
    // (ballot secrecy — the vote state carries no individual ballots).
    const vState = src.state as unknown as VoteProcessState;
    const method = getVotingMethod(vState.method ?? DEFAULT_METHOD);
    const ballots = (await getBallotChoicesForProcess(src.id)).map((c) =>
      method.parseReceipt(c),
    );
    await finalizeVote(vState, actor, ballots, {
      process_id: src.id,
      hub_id: src.hubId,
      jurisdiction: src.jurisdiction,
      emit: emitEvent,
    });
    src.status = (src.state as unknown as VoteProcessState).status;
    await saveProcessState(src);
    return;
  }

  // Generic: conversation / proposal / project simply become finalized.
  src.status = "finalized";
  await saveProcessState(src);
}
