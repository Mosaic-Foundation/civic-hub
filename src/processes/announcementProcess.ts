// civic.announcement process handler — thin adapter around the module.
//
// Announcements are not driven through the generic /process/:id/action
// dispatcher. The admin HTTP surface (/announcement/*) orchestrates the
// create / edit lifecycle directly via the module's service functions.
// This adapter exists so announcements live in the same process store
// and register as a known process type for discovery / feed rendering.

import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import {
  createAnnouncementState,
  getPublicReadModel,
  getPublicSummary,
  type AnnouncementAuthorRole,
  type AnnouncementLink,
  type AnnouncementProcessState,
  type AnnouncementSource,
  type CreateAnnouncementInput,
} from "../modules/civic.announcement/index.js";

function getState(process: Process): AnnouncementProcessState {
  return process.state as unknown as AnnouncementProcessState;
}

const announcementProcess: ProcessHandler = {
  type: "civic.announcement",
  detailPath: (id: string) => `/announcement/${id}`,

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    // Expected shape mirrors CreateAnnouncementInput. The hub's announcement
    // controller is the only caller; any other path is an error.
    const required = ["title", "body", "author_id", "author_role"] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new Error(
          `civic.announcement initializeState requires "${key}"`,
        );
      }
    }
    const createInput: CreateAnnouncementInput = {
      title: input.title as string,
      body: input.body as string,
      author_id: input.author_id as string,
      author_role: input.author_role as AnnouncementAuthorRole,
      official_type:
        typeof input.official_type === "string" ? input.official_type : null,
      links: Array.isArray(input.links)
        ? (input.links as AnnouncementLink[])
        : undefined,
      image_url:
        typeof input.image_url === "string" || input.image_url === null
          ? (input.image_url as string | null)
          : undefined,
      image_alt:
        typeof input.image_alt === "string" || input.image_alt === null
          ? (input.image_alt as string | null)
          : undefined,
      // Synced-from-external announcements pass `source` here so the module
      // records provenance and the event emitter can route the action_url
      // to the external permalink. Hand-authored announcements omit it.
      source:
        input.source && typeof input.source === "object"
          ? (input.source as AnnouncementSource)
          : undefined,
    };
    return createAnnouncementState(createInput) as unknown as Record<string, unknown>;
  },

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    // No HTTP actions reach announcements via the generic dispatcher.
    throw new Error(
      `civic.announcement does not accept process actions (received "${action.type}"). ` +
        `Create / edit happens via /announcement HTTP endpoints.`,
    );
  },

  getReadModel(process: Process): Record<string, unknown> {
    const state = getState(process);
    return getPublicReadModel(state, {
      id: process.id,
      createdAt: process.createdAt,
    });
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = getState(process);
    return getPublicSummary(state, {
      id: process.id,
      createdAt: process.createdAt,
    });
  },
};

export default announcementProcess;
