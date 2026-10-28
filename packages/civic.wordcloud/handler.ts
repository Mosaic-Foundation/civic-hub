// civic.wordcloud process handler — thin wrapper around the package's service (./service.ts).
//
// Adapts the module's service interface to the hub's ProcessHandler contract.
// Lifecycle: draft → active → closed (per ADR-003, flexible lifecycle profiles).

import {
  ValidationError,
  emitEvent,
  readProcessState,
  writeProcessState,
  str,
  num,
  type Process,
  type ProcessAction,
  type ProcessHandler,
  type FeedProcessMeta,
} from "@civic-social/plugin-sdk/first-party";
import {
  createWordcloudState,
  activateWordcloud,
  submitResponse,
  snapshotWordcloud,
  closeWordcloud,
  buildClouds,
  getSubmissionCount,
  type WordcloudProcessState,
} from "./service.js";
import { WORDCLOUD_MANIFEST } from "./manifest.js";

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


// What this type is: its manifest, ./manifest.ts.

const wordcloudProcess: ProcessHandler = {
  type: "civic.wordcloud",
  descriptor: WORDCLOUD_MANIFEST.descriptor,
  requiredSchema: [...WORDCLOUD_MANIFEST.requiredSchema],
  detailPath: WORDCLOUD_MANIFEST.detailPath,

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
    const state = { ...((await readProcessState(process.id)) ?? {}), status: "archived" };
    await writeProcessState(process.id, state);
    process.state = state;
  },

  async onRestore(
    process: Process,
    previousStatus: string,
  ): Promise<void> {
    // The word cloud's status IS a ProcessStatus, so previousStatus is
    // directly usable — no stash needed, unlike proposals/projects.
    const state = { ...((await readProcessState(process.id)) ?? {}), status: previousStatus };
    await writeProcessState(process.id, state);
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
  // The feed card's fields. The read model carries no submission count (the
  // wordcloud controller computes it separately), so one head-count here.
  // Best-effort, like the rest of the feed's metadata: a failed head-count
  // just leaves totalVotes unset rather than failing the whole feed.
  async feedMeta(model: Record<string, unknown>, processId: string): Promise<FeedProcessMeta> {
    const meta: FeedProcessMeta = {
      title: str(model.title),
      description: str(model.description),
    };
    try {
      meta.totalVotes = await getSubmissionCount(processId);
    } catch {
      // swallowed — see above.
    }
    return meta;
  },

  // Participation for the public descriptor (Architecture 3): how many
  // submissions the cloud has taken — a count and nothing else, while every
  // submission itself stays restricted on the wire.
  async participationCount(process: Process): Promise<number | null> {
    return getSubmissionCount(process.id);
  },
};

export default wordcloudProcess;
