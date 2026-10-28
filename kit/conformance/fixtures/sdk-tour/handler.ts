// The SDK tour's handler: one action for each SDK v1 capability.

import { createHash } from "node:crypto";
import {
  ConflictError,
  ValidationError,
  afterActionCommits,
  closeThroughDispatcher,
  emitEvent,
  isPastDeadline,
  type Process,
  type ProcessAction,
  type ProcessHandler,
} from "@civic-social/plugin-sdk";
import SDK_TOUR_MANIFEST, { EVENTS, TYPE } from "./manifest.js";
import { sdkTourStore } from "./store.js";

export interface SdkTourState {
  place: string;
  /** When it closes (ISO). */
  closes_at: string;
  /**
   * Who has marked it, as one-way digests of (process, account): kept in the
   * process row, written with the action, so a retried mark is refused; never
   * an account id, so serving the row leaks no one.
   */
  marked_by: string[];
}

const DAY_MS = 86_400_000;

function stateOf(process: Process): SdkTourState {
  return process.state as unknown as SdkTourState;
}

async function emit(process: Process, actor: string, event_type: string, extra: Record<string, unknown> = {}, at?: string) {
  await emitEvent({
    event_type,
    actor,
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    processType: TYPE,
    action_url_path: `/sdk-tour/${process.id}`,
    data: { process: { type: TYPE, place: stateOf(process).place }, ...extra },
    ...(at ? { timestamp: at } : {}),
  });
}

const handler: ProcessHandler = {
  type: TYPE,
  descriptor: SDK_TOUR_MANIFEST.descriptor,
  requiredSchema: [...SDK_TOUR_MANIFEST.requiredSchema],
  detailPath: SDK_TOUR_MANIFEST.detailPath,

  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    const place = typeof input.place === "string" ? input.place.trim() : "";
    if (!place) throw new ValidationError("A tour needs a place.", "place_required");
    const state: SdkTourState = { place, closes_at: new Date(Date.now() + 7 * DAY_MS).toISOString(), marked_by: [] };
    return state as unknown as Record<string, unknown>;
  },

  draftPath: (draftId: string) => `/sdk-tour/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => sdkTourStore.get().reopenDraft(draftId),

  async handleAction(process: Process, action: ProcessAction): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    switch (action.type) {
      case "mark": {
        // A retry-safe action called twice at once writes its event once: the loser
        // is run again on the winner's row, sees the caller already in marked_by, and refuses.
        const mark = createHash("sha256").update(`${process.id}:${action.actor}`).digest("hex").slice(0, 32);
        if (state.marked_by.includes(mark)) throw new ConflictError("You have already marked this tour.", "already_marked");
        state.marked_by = [...state.marked_by, mark];
        // A2: the table write waits until the action's write has won.
        const processId = process.id;
        const actor = action.actor;
        await afterActionCommits(async () => {
          await sdkTourStore.get().addMark(processId, actor);
        });
        await emit(process, action.actor, EVENTS.marked);
        return { status: "marked" };
      }
      case "join": {
        if ((await sdkTourStore.get().addJoin(process.id, action.actor)) === "already") return { status: "joined", changed: false };
        const count = (await sdkTourStore.get().joinedAccounts(process.id)).length;
        await emit(process, action.actor, EVENTS.joined, { joined: { count } });
        return { status: "joined", changed: true };
      }
      case "endorse": {
        const note = typeof action.payload.note === "string" ? action.payload.note.trim().slice(0, 500) : "";
        await emit(process, action.actor, EVENTS.endorsed, { endorsement: { note } });
        return { status: "endorsed" };
      }
      case "close": {
        process.status = "closed";
        await emit(process, action.actor, "civic.process.ended", {}, action.at);
        return { status: "closed" };
      }
      default:
        throw new ValidationError("That action isn't supported on a tour.", "action_not_supported");
    }
  },

  // A1: the creator or an admin edits an open tour's words and place.
  editPolicy(process: Process) {
    if (process.status !== "active") return { editable: false, locked_fields: [], reason: "Only an open tour can be edited." };
    return { editable: true, locked_fields: [], admins_edit: true, state_fields: ["place"] };
  },

  async draftFromProcess(process: Process, editorId: string): Promise<string> {
    return sdkTourStore.get().draftFromTour(editorId, { title: process.title, description: process.description, place: stateOf(process).place });
  },

  async syncDraftFromProcess(draftId: string, process: Process): Promise<void> {
    await sdkTourStore.get().syncDraft(draftId, { title: process.title, description: process.description, place: stateOf(process).place });
  },

  // After the hub wrote the edit: its own table.
  async onEdited(process: Process, changes) {
    const place = "place" in changes.current ? String(changes.current.place) : stateOf(process).place;
    await sdkTourStore.get().upsertPlace(process.id, place);
  },

  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    return {
      id: process.id,
      type: TYPE,
      title: process.title,
      description: process.description,
      status: process.status,
      place: state.place,
      closes_at: state.closes_at,
      joined_count: (await sdkTourStore.get().joinedAccounts(process.id)).length,
      mark_count: await sdkTourStore.get().markCount(process.id),
      has_joined: actor ? await sdkTourStore.get().hasJoined(process.id, actor) : false,
      is_creator: Boolean(actor) && actor === process.createdBy,
      created_at: process.createdAt,
    };
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = stateOf(process);
    return { id: process.id, type: TYPE, title: process.title, status: process.status, place: state.place, closes_at: state.closes_at, created_at: process.createdAt };
  },

  readAsClosed(process: Process): Process | null {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).closes_at)) return null;
    return { ...structuredClone(process), status: "closed" };
  },

  async closeIfExpired(process: Process): Promise<Process> {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).closes_at)) return process;
    return closeThroughDispatcher(process, { type: "close", actor: "system:auto-close", payload: {}, at: stateOf(process).closes_at });
  },

  async participationCount(process: Process): Promise<number | null> {
    return (await sdkTourStore.get().joinedAccounts(process.id)).length;
  },
};

export default handler;
