// civic.brief process handler — thin adapter around the civic.brief module.
//
// Registers `civic.brief` as a process type so briefs are stored in the
// same process store as votes/proposals/etc. Like civic.vote_results,
// briefs are not driven through the generic POST /process/:id/action
// dispatcher — their admin surface is /admin/briefs/*. This adapter exists
// to initialize state and produce read models.

import { ValidationError } from "../errors/index.js";
import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import type { ProcessTypeDescriptor } from "./descriptor.js";
import {
  createBriefState,
  getPublicReadModel,
  getAdminSummary,
  type BriefContent,
  type BriefProcessState,
  type CreateBriefInput,
} from "../modules/civic.brief/index.js";

function getState(process: Process): BriefProcessState {
  return process.state as unknown as BriefProcessState;
}

/**
 * What a brief is (src/processes/descriptor.ts). The hub spawns one when a
 * process closes (spawnBriefFromClosedProcess); an admin reviews, edits and
 * approves it through /admin/briefs/*, and approval publishes it and sets the
 * row to finalized. It has no process actions. An official's response
 * (POST /brief/:id/respond, a different table's write) emits action_taken
 * outside any action.
 *
 * Lifecycle: active (pending review) to finalized (published); never closed.
 */
export const BRIEF_DESCRIPTOR: ProcessTypeDescriptor = {
  type: "civic.brief",
  version: "0.1",
  tier: 1,
  plugin: "brief",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: [
    "civic.process.aggregation_completed",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
    "civic.process.action_taken",
  ],
  creation: { resident: null, admin: false, system: true },
  deadline: null,
  brief: false,
  tables: ["brief_responses"],
  outside_services: [],
  examples: {},
  // A brief is what a finished process produced: residents meet it as an
  // Outcome, and the Outcomes section lists them.
  display: {
    label: "Outcome",
    plural: "Outcomes",
    icon: "outcome",
    section: {
      id: "outcomes",
      label: "Outcomes",
      path: "/outcomes",
      detail_paths: ["/brief/", "/vote-results/"],
      order: 50,
    },
  },
};

const briefProcess: ProcessHandler = {
  type: "civic.brief",
  descriptor: BRIEF_DESCRIPTOR,
  detailPath: (id: string) => `/brief/${id}`,
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
    // Briefs are always created programmatically by the close flow
    // (spawnBriefFromClosedProcess), which passes a CreateBriefInput shape.
    const required = ["source_process_id", "source_process_type", "content"] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new ValidationError(
          "Briefs are created automatically when a process closes; they can't be created directly.",
          "cannot_create_directly",
        );
      }
    }
    const briefInput: CreateBriefInput = {
      source_process_id: input.source_process_id as string,
      source_process_type: input.source_process_type as string,
      content: input.content as BriefContent,
    };
    return createBriefState(briefInput) as unknown as Record<string, unknown>;
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    throw new ValidationError(
      "Briefs don't take actions here. Review them from the admin briefs page.",
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
    return getAdminSummary(getState(process), {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
    });
  },
};

export default briefProcess;
