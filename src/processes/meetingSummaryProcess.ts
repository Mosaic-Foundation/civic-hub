// civic.meeting_summary process handler — thin adapter around the
// civic.meeting_summary module.
//
// Registers the type so summary records live in the same process store
// as votes, proposals, briefs, and announcements. Meeting summaries are
// NOT exposed through the generic POST /process/:id/action dispatcher —
// their admin surface is /admin/meeting-summaries/*, and their cron
// creation path is /internal/meeting-summary/run. This adapter exists
// so the registry can initialize state and produce read models alongside
// other process types.

import type { Process, ProcessAction } from "../models/process.js";
import type { ProcessHandler } from "./types.js";
import {
  createMeetingSummaryState,
  getAdminReadModel,
  getAdminSummary,
  type CreateMeetingSummaryInput,
  type MeetingSourceType,
  type MeetingSummaryProcessState,
} from "../modules/civic.meeting_summary/index.js";

function getState(process: Process): MeetingSummaryProcessState {
  return process.state as unknown as MeetingSummaryProcessState;
}

const meetingSummaryProcess: ProcessHandler = {
  type: "civic.meeting_summary",
  detailPath: (id: string) => `/meeting-summary/${id}`,

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    // Meeting summaries are created programmatically by the cron
    // pipeline. Callers must pass a CreateMeetingSummaryInput shape.
    const required = [
      "source_id",
      "source_minutes_url",
      "meeting_title",
      "meeting_date",
      "blocks",
      "ai_instructions_used",
      "ai_model",
    ] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new Error(
          `civic.meeting_summary initializeState requires "${key}" — summaries can only be created by the meeting-summary cron.`,
        );
      }
    }
    const typed: CreateMeetingSummaryInput = {
      source_id: input.source_id as string,
      source_minutes_url: (input.source_minutes_url ?? null) as string | null,
      source_agenda_url: (input.source_agenda_url ?? null) as string | null,
      source_type: (input.source_type as MeetingSourceType) ?? "minutes",
      source_video_url: (input.source_video_url ?? null) as string | null,
      additional_video_urls: Array.isArray(input.additional_video_urls)
        ? (input.additional_video_urls as string[])
        : [],
      meeting_title: input.meeting_title as string,
      meeting_date: input.meeting_date as string,
      blocks: input.blocks as CreateMeetingSummaryInput["blocks"],
      ai_instructions_used: input.ai_instructions_used as string,
      ai_model: input.ai_model as string,
    };
    const state = createMeetingSummaryState(typed);
    // Bake the target process-level status into the state so
    // processService.createProcess reads it from initialState.status.
    // Matches the civic.brief convention: "active" on creation, jumps
    // to "finalized" on approval publication. (See HANDOFF Slice 3/6.)
    return {
      ...(state as unknown as Record<string, unknown>),
      status: "active",
    };
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    throw new Error(
      `civic.meeting_summary does not accept process actions (received "${action.type}"). ` +
        `Meeting summary review happens via /admin/meeting-summaries/*.`,
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

export default meetingSummaryProcess;
