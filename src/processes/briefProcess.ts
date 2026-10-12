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
import {
  createBriefState,
  getAdminReadModel,
  getAdminSummary,
  type BriefContent,
  type BriefProcessState,
  type CreateBriefInput,
} from "../modules/civic.brief/index.js";

function getState(process: Process): BriefProcessState {
  return process.state as unknown as BriefProcessState;
}

const briefProcess: ProcessHandler = {
  type: "civic.brief",
  // Residents act on this type through its own routes, or not at all.
  residentActions: [],
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

  getReadModel(process: Process): Record<string, unknown> {
    return getAdminReadModel(getState(process), {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
      createdBy: process.createdBy,
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
