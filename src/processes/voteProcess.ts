// civic.vote process handler — thin wrapper around the civic.vote module.
//
// This handler delegates all vote-specific logic to the portable module
// at /modules/civic.vote/. It adapts the module's service interface
// to the hub's ProcessHandler contract.

import { Process, ProcessAction } from "../models/process.js";
import { buildEvent, emitEvent } from "../events/eventEmitter.js";
import type { CivicEvent } from "../models/event.js";
import { ProcessHandler } from "./types.js";
import { voteAssistantConfig } from "./voteAssistantConfig.js";
import {
  createVoteState,
  propose,
  addSupport,
  removeSupport,
  activate,
  submitVote,
  closeVote,
  finalizeVote,
  getReadModel,
  getSummary,
  getVotingMethod,
  DEFAULT_METHOD,
  type VoteProcessState,
  type Ballot,
} from "../modules/civic.vote/index.js";
import {
  recordOrUpdateVote,
  clearActiveVoteKeysForProcess,
  getBallotChoicesForProcess,
  hasUserVoted,
  reshuffleBallotsForProcess,
  VoteRefusedError,
  type HeldReceipt,
} from "../modules/civic.receipts/index.js";
import { AlreadyVotedError } from "../db/atomic.js";
import { reportError } from "../utils/reportError.js";
import { getInputsByProcess } from "../modules/civic.input/index.js";
import { getActionDispatcher } from "./registry.js";
import { findExistingBriefId } from "./spawnBrief.js";
import { describeSubmissionFields } from "../shared/submissionPreview.js";
import { setVoteDraftStatus } from "../modules/civic.vote_drafts/index.js";
import type { BriefContent } from "../modules/civic.brief/index.js";

import { isPastDeadline } from "../utils/deadline.js";

// --- Helpers ---

function getState(process: Process): VoteProcessState {
  return process.state as unknown as VoteProcessState;
}

/** The actor a deadline close runs as, hourly or on read. */
export const AUTO_CLOSE_ACTOR = "system:auto-close";

function makeContext(process: Process) {
  return {
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    emit: emitEvent,
  };
}

function syncStatus(process: Process, state: VoteProcessState): void {
  process.status = state.status;
}

// --- Handler implementation ---

/** The receipt and change key a voter's browser sent with a change, if any. */
function parseHeldReceipt(raw: unknown): HeldReceipt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.receipt_id !== "string" || typeof r.change_key !== "string") return null;
  if (!r.receipt_id || r.receipt_id.length > 100 || !r.change_key || r.change_key.length > 200) return null;
  return { receipt_id: r.receipt_id, change_key: r.change_key };
}

const voteProcess: ProcessHandler = {
  // The two-table split below is the anonymous-ballot guarantee, not an
  // accident of normalization: vote_records knows the choice but not the
  // voter, vote_participation knows the voter but not the choice. The
  // forbidden columns are checked at startup so a future migration cannot
  // quietly join them back together.
  requiredSchema: [
    {
      table: "vote_records",
      // change_key_hash: the voter holds the receipt (20261010000000).
      columns: ["receipt_id", "process_id", "choice", "change_key_hash"],
      forbiddenColumns: [
        {
          column: "user_id",
          reason:
            "vote_records must never identify the voter — this column would make every past ballot attributable",
        },
      ],
      owner: "civic.vote",
    },
    {
      table: "vote_participation",
      columns: ["user_id", "process_id", "has_voted"],
      forbiddenColumns: [
        {
          column: "receipt_id",
          reason:
            "vote_participation must never link a voter to a ballot receipt",
        },
      ],
      owner: "civic.vote",
    },
    {
      // Retired 2026-10-10: only read and cleared (early voters collecting
      // a key; close). Drop this entry with the table.
      table: "active_vote_keys",
      columns: ["user_id", "process_id", "receipt_id"],
      owner: "civic.vote",
    },
  ],

  type: "civic.vote",
  detailPath: (id: string) => `/process/${id}`,
  draftPath: (draftId: string) => `/votes/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => setVoteDraftStatus(draftId, "drafting"),

  getAssistantConfig: () => voteAssistantConfig,

  // Approval does not open a vote for ballots. Unless it is explicitly
  // configured for "direct" activation (admin/dev tooling), an approved vote
  // enters the community-support phase and only opens once it clears its
  // support threshold — so the status is "proposed" and the lifecycle action
  // is "process.propose".
  //
  // Both are REQUIRED: the process row's status is set before the action runs,
  // but `addSupport` gates on state.status, which createVoteState leaves at
  // "draft". A vote whose action failed would sit visibly "proposed" while
  // silently refusing every endorsement — so a failure rolls the whole
  // approval back and the admin retries.
  activationOnApproval(process) {
    const config = (process.state as { config?: { activation_mode?: string } })
      ?.config;
    return config?.activation_mode === "direct"
      ? { status: "active", action: { type: "process.activate", onFailure: "required" } }
      : { status: "proposed", action: { type: "process.propose", onFailure: "required" } };
  },

  // A vote's submission lives on state (method, options, window) — extend the
  // generic content walk with those keys so the review previews show the
  // whole ballot as submitted.
  describeSubmission: (source) =>
    describeSubmissionFields(source, ["method", "options", "config.voting_duration_ms"]),

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    return createVoteState(input) as unknown as Record<string, unknown>;
  },

  async handleAction(
    process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    const state = getState(process);
    const ctx = makeContext(process);
    let result: Record<string, unknown>;

    switch (action.type) {
      case "process.propose": {
        const outcome = await propose(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        result = outcome.result;
        break;
      }
      case "process.support": {
        const outcome = await addSupport(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        result = outcome.result;
        break;
      }
      case "process.unsupport": {
        const outcome = await removeSupport(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        result = outcome.result;
        break;
      }
      case "process.activate": {
        const outcome = await activate(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        result = outcome.result;
        break;
      }
      case "process.vote": {
        // For yes_no_unsure: payload.option (string)
        // For approval: payload.selections (string[])
        const methodKey = state.method ?? DEFAULT_METHOD;
        const ballotInput = methodKey === "approval"
          ? action.payload.selections
          : action.payload.option;

        // Ballot secrecy (2026-10-10): the hub keeps no link from a voter
        // to their ballot. A change is the voter's browser presenting the
        // receipt and change key it was given; without them, someone who has
        // voted is refused, and their vote still counts.
        const held = parseHeldReceipt(action.payload.receipt);
        if (!held && (await hasUserVoted(action.actor, process.id))) {
          const refused = new AlreadyVotedError();
          throw new VoteRefusedError(refused.code, refused.message);
        }

        // The vote_submitted event is built here but written by cast_ballot,
        // in the same transaction as the ballot (src/db/atomic.ts): captured
        // from the module rather than emitted, so there is never an event
        // without its ballot or a ballot without its event.
        let submitted: CivicEvent | null = null;
        const voteCtx = {
          ...ctx,
          emit: async (input: Parameters<typeof emitEvent>[0]) => {
            submitted = buildEvent(input);
            return submitted;
          },
        };
        const outcome = await submitVote(
          state,
          action.actor,
          ballotInput,
          held !== null,
          voteCtx,
        );
        syncStatus(process, outcome.state);

        // Record the ballot, or change it under the voter's receipt. The
        // receipt stays the same across changes, so it always verifies to
        // the current choice. The change key is returned on a first vote
        // only, once; the hub stores its hash.
        const method = getVotingMethod(methodKey);
        const serialized = method.serializeForReceipt(outcome.result.ballot as Ballot);
        const receipt = await recordOrUpdateVote(process.id, action.actor, serialized, submitted, held);

        result = {
          ...outcome.result,
          receipt_id: receipt.receipt_id,
          ...(receipt.change_key ? { change_key: receipt.change_key } : {}),
          vote_updated: receipt.updated,
          ...(receipt.unchanged ? { unchanged: true } : {}),
        };
        break;
      }
      case "process.close": {
        // Idempotency guard for the lazy-close race: if this vote already has a
        // brief, the close already ran — don't re-tally, re-emit, or spawn a
        // duplicate. Just make sure the status reflects closed.
        const existingBriefId = await findExistingBriefId(process.id);
        if (existingBriefId) {
          if (state.status === "active") {
            state.status = "closed";
            syncStatus(process, state);
          }
          result = { already_closed: true, brief_process_id: existingBriefId };
          break;
        }

        const methodKey = state.method ?? DEFAULT_METHOD;
        const method = getVotingMethod(methodKey);
        const ballots = (await getBallotChoicesForProcess(process.id)).map(
          (c) => method.parseReceipt(c),
        );
        // A deadline close (hourly or on read) happened at the deadline, not
        // when it was noticed: its events carry that time (Phase 5 part two,
        // fix 6). A manual close has no `at` and is stamped now.
        const closeCtx = action.at
          ? { ...ctx, emit: (input: Parameters<typeof emitEvent>[0]) => ctx.emit({ ...input, timestamp: action.at }) }
          : ctx;
        const outcome = await closeVote(state, action.actor, ballots, closeCtx);
        syncStatus(process, outcome.state);
        result = outcome.result;

        // Drop any bridge rows left from before 2026-10-10 (early voters
        // who never came back for their key), then rewrite the ballots in
        // random order: every copy taken after close has no row order or
        // transaction id that lines a ballot up with its voter. A failed
        // reshuffle does not undo the close; the hourly job retries it.
        await clearActiveVoteKeysForProcess(process.id);
        try {
          await reshuffleBallotsForProcess(process.id);
        } catch (err) {
          reportError("vote.close.reshuffle", (err as Error).message, { process_id: process.id });
        }

        // A vote finishes when it closes (Adam, 2026-10-07): it is finalized
        // here and publishes its own results, which the feed and digest post
        // as the vote's "Vote results" card. The brief is separate: with
        // Briefs on, the universal seam in executeAction still spawns a
        // PENDING civic.brief from this vote (generateBrief below), and
        // approving it posts the brief and emails officials, but no longer
        // decides whether the vote is finished. Until then a vote stayed
        // `closed`, with its results unannounced, until its brief was
        // approved; with Briefs off it never finished at all.
        await finalizeVote(outcome.state, action.actor, ballots, closeCtx, { atClose: true });
        syncStatus(process, outcome.state);
        break;
      }
      // Note: there is intentionally no `process.finalize` action here. Close
      // finalizes. The older approval paths (finalizeBriefSource for a vote
      // closed before 2026-10-07, civic.vote_results) call `finalizeVote` as
      // a library import and are no-ops for a vote already finalized.
      default:
        throw new Error(`Unknown action type for civic.vote: ${action.type}`);
    }

    return result;
  },

  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const state = getState(process);
    const methodKey = state.method ?? DEFAULT_METHOD;
    const method = getVotingMethod(methodKey);

    // Actor-specific bits come from the receipts tables, never from state.
    const hasVoted = actor
      ? await hasUserVoted(actor, process.id)
      : null;

    // Ballots are only needed when results are visible AND no finalized
    // snapshot exists (finalized votes read state.result instead).
    const resultsVisible =
      state.status === "closed" ||
      state.status === "finalized" ||
      hasVoted === true;
    const ballots =
      resultsVisible && !state.result
        ? (await getBallotChoicesForProcess(process.id)).map((c) =>
            method.parseReceipt(c),
          )
        : null;

    const model = getReadModel(state, {
      id: process.id,
      title: process.title,
      description: process.description,
      createdAt: process.createdAt,
      createdBy: process.createdBy,
    }, actor, {
      has_voted: hasVoted,
      ballots,
    });

    // Include structured content and jurisdiction if present
    model.jurisdiction = process.jurisdiction;
    if (process.content) {
      model.content = process.content;
    }

    return model;
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = getState(process);
    return getSummary(state, {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
      createdBy: process.createdBy,
      status: process.status,
    });
  },

  // Lazy deadline-close: an active vote past its voting_closes_at runs the
  // normal close action, which tallies, spawns the vote-results record, and
  // emits the lifecycle events. Dispatched through the injected action
  // dispatcher so the close is persisted exactly as a manual close would be.
  async closeIfExpired(process: Process): Promise<Process> {
    const state = getState(process);
    if (state.status !== "active") return process;
    if (!isPastDeadline(state.voting_closes_at)) return process;

    console.log(
      `[auto-close] Vote ${process.id} expired at ${state.voting_closes_at}, closing now.`,
    );
    const { process: updated } = await getActionDispatcher()(process.id, {
      type: "process.close",
      actor: AUTO_CLOSE_ACTOR,
      payload: {},
      at: new Date(state.voting_closes_at!).toISOString(),
    });
    return updated;
  },

  // Universal brief: a closed vote's tally IS its results brief. Recomputes
  // the tally from the anonymized receipts (ballot secrecy — the state
  // carries no ballots) and maps it into the generic BriefContent, seeding
  // community comments from civic.input. Publishing the brief finalizes the
  // vote (finalizeVote) via finalizeBriefSource.
  async generateBrief(process: Process): Promise<BriefContent> {
    const state = getState(process);
    const method = getVotingMethod(state.method ?? DEFAULT_METHOD);
    const ballots = (await getBallotChoicesForProcess(process.id)).map((c) =>
      method.parseReceipt(c),
    );
    const result = method.computeTally(ballots, state.options);
    const total = result.total_votes;

    const entries = Object.entries(result.tally).sort((a, b) => b[1] - a[1]);
    const sectionBody = entries
      .map(([option, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `• ${option}: ${count} (${pct}%)`;
      })
      .join("\n");

    let comments: string[] = [];
    try {
      const inputs = await getInputsByProcess(process.id);
      comments = inputs.map((i) => i.body.trim()).filter((b) => b.length > 0);
    } catch {
      // Best-effort — admin can add comments during review.
    }

    return {
      title: process.title,
      headline: method.summarizeTally(result) || "The community has voted",
      summary: process.description ?? "",
      sections: entries.length > 0 ? [{ heading: "Results", body: sectionBody }] : [],
      participation_label: `${total} vote${total === 1 ? "" : "s"} cast`,
      participation_count: total,
      comments,
      admin_notes: "",
    };
  },
};

export default voteProcess;
