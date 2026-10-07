// Finish votes that closed but were never finalized (2026-10-07).
//
// Until 2026-10-07 a vote was finalized only when an admin approved its brief.
// A vote that closed while the Briefs plugin was off got no brief, so nothing
// ever finished it: it stayed `closed`, its results never announced. Since
// then every vote finishes at close (src/processes/voteProcess.ts); this
// finishes the ones left behind, the same way.
//
// What counts as stuck: a civic.vote in `closed` with NO brief. A closed vote
// that has a brief is left alone: it finishes when that brief is approved.
//
// What finishing does, per vote, exactly as a close does today:
//   - finalizeVote with the anonymized ballots, marked `atClose`, so its
//     result_published becomes the vote's "Vote results" card in the feed;
//   - the status change closed → finalized and its civic.process.updated
//     event, in one transaction (transition_process).
// Both events are stamped with the vote's close time (its civic.process.ended
// event, else voting_closes_at), so the card sits where the vote closed in the
// feed; they are recorded now, so the next resident digest carries them.
//
// Runs inside a hub's scope (scripts/lib/hubScope.ts withScriptHub).

import { forHub } from "../../src/db/forHub.js";
import { transitionProcess } from "../../src/db/atomic.js";
import { currentHubId } from "../../src/config/hubContext.js";
import { buildEvent, emitEvent } from "../../src/events/eventEmitter.js";
import { getProcess } from "../../src/services/processService.js";
import { findExistingBriefId } from "../../src/processes/spawnBrief.js";
import {
  finalizeVote,
  getVotingMethod,
  DEFAULT_METHOD,
  type VoteProcessState,
} from "../../src/modules/civic.vote/index.js";
import { getBallotChoicesForProcess } from "../../src/modules/civic.receipts/index.js";

export const FINISH_ACTOR = "system:finish-stuck-votes";

export interface StuckVote {
  id: string;
  title: string;
  closed_at: string | null;
  /** Ballots counted; filled in once finished. */
  total_votes?: number;
}

export interface FinishReport {
  /** Closed votes with no brief: finished on apply, listed on a dry run. */
  stuck: StuckVote[];
  /** Closed votes that have a brief: left to finish when it is approved. */
  waiting_on_brief: Array<{ id: string; title: string; brief_id: string }>;
  /** Closed rows whose own state disagrees (not a vote this can finish safely). */
  skipped: Array<{ id: string; title: string; reason: string }>;
  /** Finishing threw; the rest of the run carried on. */
  failed: Array<{ id: string; title: string; error: string }>;
  applied: boolean;
}

/** When the vote closed: its ended event, else its scheduled close, else null. */
async function closedAt(id: string, state: VoteProcessState): Promise<string | null> {
  const ended = await forHub(currentHubId())
    .from("events")
    .select<{ created_at: string }>("created_at")
    .eq("process_id", id)
    .eq("event_type", "civic.process.ended")
    .order("created_at", { ascending: false })
    .limit(1);
  return ended[0]?.created_at ?? state.voting_closes_at ?? null;
}

export async function finishStuckVotes(opts: { apply: boolean }): Promise<FinishReport> {
  const rows = await forHub(currentHubId())
    .from("processes")
    .select<{ id: string; title: string }>("id, title")
    .eq("type", "civic.vote")
    .eq("status", "closed")
    .order("created_at", { ascending: true });

  const report: FinishReport = { stuck: [], waiting_on_brief: [], skipped: [], failed: [], applied: opts.apply };

  for (const row of rows) {
    const briefId = await findExistingBriefId(row.id);
    if (briefId) {
      report.waiting_on_brief.push({ id: row.id, title: row.title, brief_id: briefId });
      continue;
    }

    const process = await getProcess(row.id);
    if (!process || process.status !== "closed") continue;
    const state = process.state as unknown as VoteProcessState;
    if (state.status !== "closed") {
      report.skipped.push({
        id: row.id,
        title: row.title,
        reason: `the row is closed but its state says "${String(state.status)}"`,
      });
      continue;
    }
    const at = await closedAt(row.id, state);
    const entry: StuckVote = { id: row.id, title: row.title, closed_at: at };
    if (!opts.apply) {
      report.stuck.push(entry);
      continue;
    }
    try {
      await finish(process, state, at, entry);
      report.stuck.push(entry);
    } catch (err) {
      report.failed.push({ id: row.id, title: row.title, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return report;
}

/** Finish one vote: final tally (marked atClose), then closed → finalized with its event. */
async function finish(
  process: NonNullable<Awaited<ReturnType<typeof getProcess>>>,
  state: VoteProcessState,
  at: string | null,
  entry: StuckVote,
): Promise<void> {
  const method = getVotingMethod(state.method ?? DEFAULT_METHOD);
  const ballots = (await getBallotChoicesForProcess(process.id)).map((c) => method.parseReceipt(c));
  const ctx = {
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    emit: (input: Parameters<typeof emitEvent>[0]) => emitEvent(at ? { ...input, timestamp: at } : input),
  };
  await finalizeVote(state, FINISH_ACTOR, ballots, ctx, { atClose: true });
  entry.total_votes = state.result?.total_votes ?? 0;

  await transitionProcess({
    hubId: currentHubId(),
    processId: process.id,
    toStatus: "finalized",
    actor: FINISH_ACTOR,
    event: buildEvent({
      event_type: "civic.process.updated",
      actor: FINISH_ACTOR,
      process_id: process.id,
      jurisdiction: process.jurisdiction,
      processType: "civic.vote",
      data: { process: { previous_status: "closed", status: "finalized" } },
      ...(at ? { timestamp: at } : {}),
    }),
    state: process.state,
  });
}
