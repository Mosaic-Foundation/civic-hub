// Events' handler: its actions, and how one reads.

import {
  ValidationError,
  afterActionCommits,
  closeThroughDispatcher,
  emitEvent,
  isPastDeadline,
  type Process,
  type ProcessAction,
  type ProcessHandler,
} from "@civic-social/plugin-sdk";
import EVENT_MANIFEST, { TYPE } from "./manifest.js";
import { eventStore } from "./store.js";
import {
  EventInputError,
  REASON_MAX,
  checkLocation,
  checkTimes,
  eventBlock,
  instant,
  type EventState,
} from "./event.js";

function stateOf(process: Process): EventState {
  return process.state as unknown as EventState;
}

/** An EventInputError as the hub's 400; anything else as it is. */
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof EventInputError) throw new ValidationError(err.message, err.code);
    throw err;
  }
}

/** One of its events, carrying the event block every one of them carries (event.ts). */
async function emit(
  process: Process,
  actor: string,
  e: { event_type: string; extra?: Record<string, unknown>; at?: string },
) {
  await emitEvent({
    event_type: e.event_type,
    actor,
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    processType: TYPE,
    action_url_path: `/events/${process.id}`,
    data: { process: eventBlock(process.title, process.description, stateOf(process)), ...e.extra },
    ...(e.at ? { timestamp: e.at } : {}),
  });
}

/**
 * Put the event's row on the calendar as it now is, once the action's
 * transaction has committed (engine 2, A2): an action that lost a race and is
 * run again, or failed, writes nothing here, so publish, cancel and the close
 * are retry-safe. Outside an action (an edit) it writes at once.
 */
async function index(process: Process): Promise<void> {
  const snapshot = structuredClone(process);
  await afterActionCommits(() => writeIndex(snapshot));
}

async function writeIndex(process: Process): Promise<void> {
  const state = stateOf(process);
  await eventStore.get().upsertEvent({
    process_id: process.id,
    title: process.title,
    description: process.description,
    start_time: state.start_time,
    end_time: state.end_time,
    location: state.location,
    cancelled: Boolean(state.cancelled),
  });
}

async function attendance(process: Process) {
  return { attendance: { count: await eventStore.get().goingCount(process.id) } };
}

const handler: ProcessHandler = {
  type: TYPE,
  descriptor: EVENT_MANIFEST.descriptor,
  requiredSchema: [...EVENT_MANIFEST.requiredSchema],
  detailPath: EVENT_MANIFEST.detailPath,

  // A submission's state (draftKind.ts build), checked again here: this is
  // the one way an event comes into being.
  initializeState(input: Record<string, unknown>): Record<string, unknown> {
    return checked(() => {
      const times = checkTimes(instant(input.start_time, "The start"), instant(input.end_time, "The end"));
      const state: EventState = { ...times, location: checkLocation(input.location), cancelled: null };
      return state as unknown as Record<string, unknown>;
    });
  },

  // "Edit & resubmit" after an admin asks for changes: back to its form, its
  // draft drafting again (the package owns its drafts table).
  draftPath: (draftId: string) => `/events/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => eventStore.get().reopenDraft(draftId),

  // Approval puts it on the calendar: publish runs in the approval, so an
  // event is never live without its Create.
  activationOnApproval() {
    return { status: "active", action: { type: "publish", onFailure: "required" } };
  },

  async handleAction(process: Process, action: ProcessAction): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    switch (action.type) {
      case "publish": {
        process.status = "active";
        await index(process);
        await emit(process, action.actor, { event_type: "civic.event.published" });
        return { status: "published" };
      }
      case "cancel": {
        const reason = typeof action.payload.reason === "string" ? action.payload.reason.trim() : "";
        if (reason.length > REASON_MAX) throw new ValidationError(`The reason can be at most ${REASON_MAX} characters.`, "too_long");
        state.cancelled = { at: new Date().toISOString(), reason };
        process.status = "closed";
        await index(process);
        await emit(process, action.actor, { event_type: "civic.event.cancelled", extra: { cancellation: { reason } } });
        return { status: "cancelled" };
      }
      case "going": {
        if ((await eventStore.get().addGoing(process.id, action.actor)) === "already") return { status: "going", changed: false };
        await emit(process, action.actor, { event_type: "civic.event.going", extra: await attendance(process) });
        return { status: "going", changed: true };
      }
      case "not_going": {
        if (!(await eventStore.get().removeGoing(process.id, action.actor))) return { status: "not_going", changed: false };
        await emit(process, action.actor, { event_type: "civic.event.not_going", extra: await attendance(process) });
        return { status: "not_going", changed: true };
      }
      case "close": {
        // Only marks it past: an event has no result to publish.
        process.status = "closed";
        await emit(process, action.actor, { event_type: "civic.process.ended", at: action.at });
        return { status: "past" };
      }
      default:
        throw new ValidationError("That action isn't supported on an event.", "action_not_supported");
    }
  },

  // "Edit event" (engine 2, A1): the hub's edit path, with the Code of
  // Conduct check on its words and its place. The creator and the hub's
  // admins edit everything of an upcoming event (Adam, 2026-10-27): its name,
  // what it is, when and where.
  editPolicy(process: Process) {
    if (process.status !== "active") {
      return { editable: false, locked_fields: [], reason: "Only an upcoming event can be edited." };
    }
    return { editable: true, locked_fields: [], admins_edit: true, state_fields: ["start_time", "end_time", "location"] };
  },

  async draftFromProcess(process: Process, editorId: string): Promise<string> {
    return eventStore.get().draftFromEvent(editorId, { title: process.title, description: process.description, state: stateOf(process) });
  },

  async syncDraftFromProcess(draftId: string, process: Process): Promise<void> {
    await eventStore.get().syncDraft(draftId, { title: process.title, description: process.description, state: stateOf(process) });
  },

  // After the hub wrote the edit (and its civic.process.updated): the
  // calendar row, and the AS2 Update of the Event its readers follow.
  async onEdited(process: Process, changes, editor) {
    const edited = structuredClone(process);
    for (const key of ["title", "description"] as const) if (key in changes.current) edited[key] = String(changes.current[key]);
    const state = stateOf(edited);
    for (const key of ["start_time", "end_time", "location"] as const) {
      if (key in changes.current) (state as unknown as Record<string, unknown>)[key] = changes.current[key];
    }
    await writeIndex(edited);
    await emit(edited, editor?.id ?? process.createdBy, { event_type: "civic.event.updated", extra: { edit: { changed_fields: changes.changed_fields } } });
  },

  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    return {
      id: process.id,
      type: TYPE,
      title: process.title,
      description: process.description,
      status: process.status,
      start_time: state.start_time,
      end_time: state.end_time,
      location: state.location,
      cancelled: state.cancelled,
      going_count: await eventStore.get().goingCount(process.id),
      is_going: actor ? await eventStore.get().isGoing(process.id, actor) : false,
      // Whether the reader made it (never whose it is): its creator may edit or cancel it.
      is_creator: Boolean(actor) && actor === process.createdBy,
      created_at: process.createdAt,
    };
  },

  getSummary(process: Process): Record<string, unknown> {
    const state = stateOf(process);
    return {
      id: process.id,
      type: TYPE,
      title: process.title,
      status: process.status,
      start_time: state.start_time,
      end_time: state.end_time,
      cancelled: Boolean(state.cancelled),
      created_at: process.createdAt,
    };
  },

  // Past its end it reads as past at once; the hub's close job runs the close.
  readAsClosed(process: Process): Process | null {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).end_time)) return null;
    return { ...structuredClone(process), status: "closed" };
  },

  async closeIfExpired(process: Process): Promise<Process> {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).end_time)) return process;
    return closeThroughDispatcher(process, { type: "close", actor: "system:auto-close", payload: {}, at: stateOf(process).end_time });
  },

  async onArchive(process: Process): Promise<void> {
    await eventStore.get().setArchived(process.id, true);
  },

  async onRestore(process: Process): Promise<void> {
    await eventStore.get().setArchived(process.id, false);
  },

  async participationCount(process: Process): Promise<number | null> {
    return eventStore.get().goingCount(process.id);
  },
};

export default handler;
