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

import { ValidationError } from "../errors/index.js";
import type { Process, ProcessAction } from "../models/process.js";
import type { ProcessHandler } from "./types.js";
import { CONTRACT_VERSION, type ProcessTypeDescriptor } from "./descriptor.js";
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

/**
 * What a meeting summary is (src/processes/descriptor.ts). The meeting
 * summary job (/internal/meeting-summary/run) creates one pending review; an
 * admin edits and approves it through /admin/meeting-summaries/*, and
 * approval publishes it and sets the row to finalized. The job may also
 * publish one itself. It has no process actions. A revision staged on a
 * published summary stays on its state; the row stays finalized.
 *
 * Spec mismatch: Civic Process Spec §4.2 "publish" is published then
 * archived; this type goes active (pending review) to finalized (published)
 * and never uses closed.
 */
export const MEETING_SUMMARY_DESCRIPTOR: ProcessTypeDescriptor = {
  type: "civic.meeting_summary",
  version: "0.1",
  contract: CONTRACT_VERSION,
  tier: 1,
  plugin: "meeting_summary",
  lifecycle_profile: "publish",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: [
    "civic.process.aggregation_completed",
    "civic.process.outcome_recorded",
    "civic.process.result_published",
  ],
  creation: { resident: null, admin: false, system: true },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {},
};

const meetingSummaryProcess: ProcessHandler = {
  type: "civic.meeting_summary",
  descriptor: MEETING_SUMMARY_DESCRIPTOR,
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
        throw new ValidationError(
          "Meeting summaries are created automatically; they can't be created directly.",
          "cannot_create_directly",
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
    throw new ValidationError(
      "Meeting summaries don't take actions here. Review them from the admin meeting-summaries page.",
        "action_not_supported",
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
