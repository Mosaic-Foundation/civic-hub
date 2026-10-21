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

import { ValidationError } from "../../errors/index.js";
import { Process, ProcessAction } from "../../models/process.js";
import { ProcessHandler } from "../../processes/types.js";
import type { ProcessTypeDescriptor } from "../../processes/descriptor.js";
import {
  createVoteResultsState,
  getPublicReadModel,
  getAdminSummary,
  type CreateVoteResultsFromVoteInput,
  type VoteResultsProcessState,
} from "./index.js";

function getState(process: Process): VoteResultsProcessState {
  return process.state as unknown as VoteResultsProcessState;
}

/**
 * What a vote-results record is (src/processes/descriptor.ts). A legacy
 * record: votes stopped creating them when briefs became the one results
 * artifact (the vote's close, src/processes/types.ts generateBrief), but the
 * type stays registered for the records that exist and for their admin
 * routes (/admin/vote-results/*). It has no process actions: edit and approve
 * are those routes, and their events are listed in `emits` only. Approval
 * emails the board, then sets the row to finalized.
 *
 * Lifecycle: active (created, pending review) to finalized (published); never
 * closed.
 */
export const VOTE_RESULTS_DESCRIPTOR: ProcessTypeDescriptor = {
  type: "civic.vote_results",
  version: "0.1",
  tier: 1,
  plugin: "vote",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: [
    "civic.process.aggregation_completed",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
  ],
  creation: { resident: null, admin: false, system: false },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {},
  // The pre-brief results record: an Outcome too, listed under Outcomes
  // (the brief's section, whose detail paths include /vote-results/).
  display: { label: "Outcome", plural: "Outcomes", icon: "outcome" },
};

const voteResultsProcess: ProcessHandler = {
  type: "civic.vote_results",
  descriptor: VOTE_RESULTS_DESCRIPTOR,
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
        throw new ValidationError(
          "Vote results are created automatically when a vote closes; they can't be created directly.",
          "cannot_create_directly",
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
    throw new ValidationError(
      "Vote results don't take actions here. Review them from the admin vote-results page.",
        "action_not_supported",
    );
  },

  // GET /process/:id/state is public: the published record only (null until
  // then, so it is not found). It served the admin read model until
  // 2026-10-13: unpublished text, and for briefs the recipients' emails.
  // Admin pages read the admin model through their own routes.
  getReadModel(process: Process): Record<string, unknown> | null {
    return getPublicReadModel(getState(process), {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
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
