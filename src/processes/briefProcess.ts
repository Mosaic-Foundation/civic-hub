// civic.brief process handler — thin adapter around the civic.brief module.
//
// Registers `civic.brief` as a process type so briefs are stored in the
// same process store as votes/proposals/etc. Like civic.vote_results,
// briefs are not driven through the generic POST /process/:id/action
// dispatcher — their admin surface is /admin/briefs/*. This adapter exists
// to initialize state and produce read models.

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

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    // Briefs are always created programmatically by the close flow
    // (spawnBriefFromClosedProcess), which passes a CreateBriefInput shape.
    const required = ["source_process_id", "source_process_type", "content"] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new Error(
          `civic.brief initializeState requires "${key}" — briefs can only be created by the process-close flow.`,
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
    throw new Error(
      `civic.brief does not accept process actions (received "${action.type}"). ` +
        `Brief review happens via /admin/briefs/*.`,
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
