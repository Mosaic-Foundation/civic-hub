// civic.announcement process handler — thin adapter around the module.
//
// Announcements are not driven through the generic /process/:id/action
// dispatcher. The admin HTTP surface (/announcement/*) orchestrates the
// create / edit lifecycle directly via the module's service functions.
// This adapter exists so announcements live in the same process store
// and register as a known process type for discovery / feed rendering.

import { ValidationError } from "../errors/index.js";
import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import type { ProcessTypeDescriptor } from "./descriptor.js";
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

/**
 * What an announcement is (src/processes/descriptor.ts). It is published the
 * moment it is made: the announcement routes (admins and officials) and the
 * news sync job create the row, emit result_published, and set it to
 * finalized. Edits, removal and restore are those routes and emit only
 * civic.process.updated. It has no process actions.
 *
 * Lifecycle: born active and finalized in the same request (the row is never
 * observably active).
 */
export const ANNOUNCEMENT_DESCRIPTOR: ProcessTypeDescriptor = {
  type: "civic.announcement",
  version: "0.1",
  tier: 1,
  plugin: "announcement",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: ["civic.process.result_published"],
  creation: { resident: null, admin: true, system: true },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {
    create: { path: "/announcement", body: { title: "Conformance announcement", body: "A notice." } },
  },
};

const announcementProcess: ProcessHandler = {
  type: "civic.announcement",
  descriptor: ANNOUNCEMENT_DESCRIPTOR,
  detailPath: (id: string) => `/announcement/${id}`,

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    // Expected shape mirrors CreateAnnouncementInput. The hub's announcement
    // controller is the only caller; any other path is an error.
    const required = ["title", "body", "author_id", "author_role"] as const;
    for (const key of required) {
      if (!(key in input)) {
        throw new ValidationError(
          `An announcement needs a ${key.replace("_", " ")}.`,
          "missing_field",
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
    throw new ValidationError(
      "Announcements don't take actions here. Create and edit them from the announcements page.",
        "action_not_supported",
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
