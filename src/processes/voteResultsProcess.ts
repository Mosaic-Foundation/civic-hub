// civic.vote_results process handler — thin adapter around the
// civic.vote_results module.
//
// The handler registers `civic.vote_results` as a process type so
// vote-results records are stored in the same process store as votes
// and proposals. Vote-results are not exposed through the generic
// `POST /process/:id/action` dispatcher — their admin surface is
// `/admin/vote-results/*`. This adapter therefore accepts no actions;
// it exists to give the registry a way to initialize state and produce
// read models for vote-results alongside other process types.
//
// Renamed from `briefProcess.ts` in Slice 8.5. Behavior is unchanged
// beyond the rename + the new vote_context snapshot input fields.

import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import {
  createVoteResultsState,
  getAdminReadModel,
  getAdminSummary,
  type CreateVoteResultsFromVoteInput,
  type VoteResultsProcessState,
} from "../modules/civic.vote_results/index.js";

function getState(process: Process): VoteResultsProcessState {
  return process.state as unknown as VoteResultsProcessState;
}

const voteResultsProcess: ProcessHandler = {
  type: "civic.vote_results",
  detailPath: (id: string) => `/vote-results/${id}`,
  // Social previews carry the approved headline, not the (empty) row
  // description. Unpublished records are not shareable at all.
  describeShare: (process) => {
    const state = process.state as {
      publication_status?: unknown;
      content?: { headline?: unknown; image_url?: unknown };
    };
    if (state.publication_status !== "published") return null;
    const headline =
      typeof state.content?.headline === "string" ? state.content.headline.trim() : "";
    return headline ? { description: headline } : {};
  },

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    // Vote-results records are always created programmatically (from a
    // closed vote), so we expect the host hub to pass a
    // CreateVoteResultsFromVoteInput shape in the initialization input.
    // Callers outside the vote-close flow are not supported.
    const required = [
      "source_process_id",
      "vote_title",
      "vote_description",
      "vote_options",
      "tally",
      "total_votes",
    ] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new Error(
          `civic.vote_results initializeState requires "${key}" — vote-results can only be created by the vote-close flow.`,
        );
      }
    }
    const voteResultsInput: CreateVoteResultsFromVoteInput = {
      source_process_id: input.source_process_id as string,
      vote_title: input.vote_title as string,
      vote_description: input.vote_description as string,
      vote_options: input.vote_options as Array<{
        option_id: string;
        option_label: string;
      }>,
      vote_starts_at: (input.vote_starts_at as string | null) ?? null,
      vote_ends_at: (input.vote_ends_at as string | null) ?? null,
      tally: input.tally as Record<string, number>,
      total_votes: input.total_votes as number,
      comments: Array.isArray(input.comments)
        ? (input.comments as string[])
        : undefined,
    };
    return createVoteResultsState(voteResultsInput) as unknown as Record<
      string,
      unknown
    >;
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    // No HTTP actions reach vote-results records. Any attempt indicates
    // a misrouting.
    throw new Error(
      `civic.vote_results does not accept process actions (received "${action.type}"). ` +
        `Vote-results review happens via /admin/vote-results/*.`,
    );
  },

  getReadModel(process: Process): Record<string, unknown> {
    const state = getState(process);
    return getAdminReadModel(state, {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
      createdBy: process.createdBy,
    });
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = getState(process);
    return getAdminSummary(state, {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
    });
  },
};

export default voteResultsProcess;
