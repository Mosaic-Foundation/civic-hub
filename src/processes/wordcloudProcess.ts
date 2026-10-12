// civic.wordcloud process handler — thin wrapper around the civic.wordcloud module.
//
// Adapts the module's service interface to the hub's ProcessHandler contract.
// Lifecycle: draft → active → closed (per ADR-003, flexible lifecycle profiles).

import { ValidationError } from "../errors/index.js";
import { Process, ProcessAction } from "../models/process.js";
import { emitEvent } from "../events/eventEmitter.js";
import { ProcessHandler } from "./types.js";
import type { ProcessTypeDescriptor } from "./descriptor.js";
import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import {
  createWordcloudState,
  activateWordcloud,
  submitResponse,
  snapshotWordcloud,
  closeWordcloud,
  buildClouds,
  getSubmissionCount,
  type WordcloudProcessState,
} from "../modules/civic.wordcloud/index.js";

function getState(process: Process): WordcloudProcessState {
  return process.state as unknown as WordcloudProcessState;
}

function makeContext(process: Process) {
  return {
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    emit: emitEvent,
  };
}

function syncStatus(process: Process, state: WordcloudProcessState): void {
  process.status = state.status;
}

function db() {
  return forHub(currentHubId());
}

// What this type is: WORDCLOUD_DESCRIPTOR below.

/**
 * What a word cloud is (src/processes/descriptor.ts). Residents submit one
 * short answer per prompt while it is active; activate, snapshot and close
 * are an admin's. Neither a deadline nor a brief: an evergreen cloud stays
 * active until an admin closes it.
 *
 * Retry-safe: activate, snapshot and close change only the process row and
 * their events (snapshot and close only read the submissions table). A
 * submission is not: it writes a row of its own.
 *
 * The word cloud keeps a copy of its status on state, synced with the row.
 *
 * Lifecycle: draft, active, closed; it stops at closed.
 */
export const WORDCLOUD_DESCRIPTOR: ProcessTypeDescriptor = {
  type: "civic.wordcloud",
  version: "0.1",
  tier: 1,
  plugin: "wordcloud",
  states: ["draft", "active", "closed"],
  initial_status: "draft",
  actions: [
    {
      name: "process.activate",
      description: "Open the word cloud for submissions",
      callers: ["admin"],
      from: ["draft"],
      to: "active",
      emits: ["civic.process.started"],
      retry_safe: true,
    },
    {
      name: "process.submit",
      description: "Submit a short answer to one of the prompts",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.process.submission_received"],
      once_per_participant: true,
      input_schema: {
        type: "object",
        properties: {
          prompt_id: { type: "string" },
          text: { type: "string" },
          device_token: { type: "string" },
        },
        required: ["prompt_id", "text"],
        examples: [{ prompt_id: "prompt_1", text: "parks" }],
      },
    },
    {
      name: "process.snapshot",
      description: "Publish a point-in-time snapshot of the cloud",
      callers: ["admin"],
      from: ["active"],
      to: null,
      emits: ["civic.process.result_published"],
      retry_safe: true,
    },
    {
      name: "process.close",
      description: "Close submissions and publish the final cloud",
      callers: ["admin"],
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended", "civic.process.result_published"],
      retry_safe: true,
    },
  ],
  emits: [
    "civic.process.started",
    "civic.process.submission_received",
    "civic.process.result_published",
    "civic.process.ended",
  ],
  creation: { resident: null, admin: true, system: false },
  deadline: null,
  brief: false,
  tables: ["wordcloud_submissions"],
  outside_services: [],
  examples: {
    create: {
      body: {
        definition: { type: "civic.wordcloud", version: "0.1" },
        title: "Conformance word cloud",
        description: "One word.",
        state: { prompts: [{ id: "p1", text: "One word?" }] },
      },
    },
  },
};

const wordcloudProcess: ProcessHandler = {
  requiredSchema: [
    {
      table: "wordcloud_submissions",
      columns: ["id", "process_id", "prompt_id", "author_id", "body"],
      owner: "civic.wordcloud",
    },
  ],

  type: "civic.wordcloud",
  descriptor: WORDCLOUD_DESCRIPTOR,
  detailPath: (id: string) => `/wordcloud/${id}`,


  /**
   * The word cloud keeps its own `status` inside `state` — the submission form
   * reads that copy, not the processes column (see HANDOFF, "Word cloud"). So
   * archiving must flip both or an archived word cloud keeps accepting words.
   *
   * archiveProcess has already written `state` with the archive metadata by
   * the time this runs, so re-read and patch rather than using the in-memory
   * copy this handler was handed.
   */
  async onArchive(process: Process): Promise<void> {
    const hubDb = db();
    const data = await hubDb
      .from("processes").select<{ state: Record<string, unknown> }>("state").eq("id", process.id).maybeSingle();
    const state = { ...((data?.state as Record<string, unknown>) ?? {}), status: "archived" };
    await hubDb.from("processes").update({ state }).eq("id", process.id);
    process.state = state;
  },

  async onRestore(
    process: Process,
    previousStatus: string,
  ): Promise<void> {
    // The word cloud's status IS a ProcessStatus, so previousStatus is
    // directly usable — no stash needed, unlike proposals/projects.
    const hubDb = db();
    const data = await hubDb
      .from("processes").select<{ state: Record<string, unknown> }>("state").eq("id", process.id).maybeSingle();
    const state = { ...((data?.state as Record<string, unknown>) ?? {}), status: previousStatus };
    await hubDb.from("processes").update({ state }).eq("id", process.id);
    process.state = state;
  },

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    return createWordcloudState(input) as unknown as Record<string, unknown>;
  },

  async handleAction(
    process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    const state = getState(process);
    const ctx = makeContext(process);

    switch (action.type) {
      case "process.activate": {
        const outcome = await activateWordcloud(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        return outcome.result;
      }
      case "process.submit": {
        const outcome = await submitResponse(
          state,
          action.actor,
          {
            prompt_id: action.payload.prompt_id as string,
            text: action.payload.text as string,
            device_token: action.payload.device_token as string | undefined,
          },
          ctx,
        );
        syncStatus(process, outcome.state);
        return outcome.result;
      }
      case "process.snapshot": {
        const outcome = await snapshotWordcloud(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        return outcome.result;
      }
      case "process.close": {
        const outcome = await closeWordcloud(state, action.actor, ctx);
        syncStatus(process, outcome.state);
        return outcome.result;
      }
      default:
        throw new ValidationError("That action isn't supported on a word cloud.", "action_not_supported");
    }
  },

  getReadModel(process: Process, _actor?: string): Record<string, unknown> {
    const state = getState(process);
    return {
      id: process.id,
      type: "civic.wordcloud",
      title: process.title,
      description: process.description,
      status: state.status,
      prompts: state.prompts,
      lifecycle_mode: state.lifecycle_mode,
      config: state.config,
      jurisdiction: process.jurisdiction,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = getState(process);
    return {
      id: process.id,
      type: "civic.wordcloud",
      title: process.title,
      status: process.status,
      lifecycle_mode: state.lifecycle_mode,
      prompt_count: state.prompts.length,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },
};

export default wordcloudProcess;
