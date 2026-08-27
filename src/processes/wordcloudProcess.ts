// civic.wordcloud process handler — thin wrapper around the civic.wordcloud module.
//
// Adapts the module's service interface to the hub's ProcessHandler contract.
// Lifecycle: draft → active → closed (per ADR-003, flexible lifecycle profiles).

import { Process, ProcessAction } from "../models/process.js";
import { emitEvent } from "../events/eventEmitter.js";
import { ProcessHandler } from "./types.js";
import { getDb } from "../db/client.js";
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
    hub_id: process.hubId,
    jurisdiction: process.jurisdiction,
    emit: emitEvent,
  };
}

function syncStatus(process: Process, state: WordcloudProcessState): void {
  process.status = state.status;
}

export const PROCESS_DESCRIPTOR = {
  type: "civic.wordcloud",
  version: "0.1",
  lifecycle: {
    states: ["draft", "active", "closed"],
    transitions: [
      { from: "draft", to: "active", action: "process.activate" },
      { from: "active", to: "closed", action: "process.close" },
    ],
  },
  actions: [
    { name: "process.activate", from: ["draft"], to: "active", description: "Open for submissions" },
    { name: "process.submit", from: ["active"], to: null, description: "Submit a response to a prompt" },
    { name: "process.snapshot", from: ["active"], to: null, description: "Publish a point-in-time snapshot of the cloud" },
    { name: "process.close", from: ["active"], to: "closed", description: "Close submissions and publish final result" },
  ],
  config_schema: {
    prompts: { type: "array", description: "One or more prompts with { id, text, max_length? }" },
    lifecycle_mode: { type: "string", enum: ["fixed", "evergreen"], default: "evergreen" },
    max_submission_length: { type: "number", default: 280 },
    display_threshold: { type: "number", default: 1 },
  },
  events: [
    "civic.process.started",
    "civic.process.submission_received",
    "civic.process.result_published",
    "civic.process.ended",
  ],
} as const;

const wordcloudProcess: ProcessHandler = {
  requiredSchema: [
    {
      table: "wordcloud_submissions",
      columns: ["id", "process_id", "prompt_id", "author_id", "body"],
      owner: "civic.wordcloud",
    },
  ],

  type: "civic.wordcloud",
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
    const db = getDb();
    const { data, error: readErr } = await db
      .from("processes").select("state").eq("id", process.id).maybeSingle();
    if (readErr) throw new Error(`wordcloud archive read failed: ${readErr.message}`);
    const state = { ...((data?.state as Record<string, unknown>) ?? {}), status: "archived" };
    const { error } = await db.from("processes").update({ state }).eq("id", process.id);
    if (error) throw new Error(`wordcloud archive failed: ${error.message}`);
    process.state = state;
  },

  async onRestore(
    process: Process,
    previousStatus: string,
  ): Promise<void> {
    // The word cloud's status IS a ProcessStatus, so previousStatus is
    // directly usable — no stash needed, unlike proposals/projects.
    const db = getDb();
    const { data, error: readErr } = await db
      .from("processes").select("state").eq("id", process.id).maybeSingle();
    if (readErr) throw new Error(`wordcloud restore read failed: ${readErr.message}`);
    const state = { ...((data?.state as Record<string, unknown>) ?? {}), status: previousStatus };
    const { error } = await db.from("processes").update({ state }).eq("id", process.id);
    if (error) throw new Error(`wordcloud restore failed: ${error.message}`);
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
        throw new Error(`Unknown action type for civic.wordcloud: ${action.type}`);
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
