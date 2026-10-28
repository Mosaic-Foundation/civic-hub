// Events' handler: its actions, and how one reads.

import {
  ConflictError,
  ValidationError,
  afterActionCommits,
  closeThroughDispatcher,
  emitEvent,
  hubContext,
  isPastDeadline,
  notify,
  type Process,
  type ProcessAction,
  type ProcessHandler,
} from "@civic-social/plugin-sdk";
import EVENT_MANIFEST, { EVENTS, TYPE } from "./manifest.js";
import { eventStore } from "./store.js";
import {
  EventInputError,
  MESSAGE_MAX,
  REASON_MAX,
  SUBJECT_MAX,
  capacityOf,
  checkLocation,
  checkTimes,
  eventBlock,
  changeText,
  imageOf,
  instant,
  timeZoneOf,
  whenText,
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

/** The zone an event's times are given in: its own, else the hub's (events before 0.3.0). */
function zoneOf(state: EventState): string {
  return state.time_zone ?? hubContext().timeZone;
}

/** One of its events, carrying the event block every one of them carries (event.ts). */
async function emit(
  process: Process,
  actor: string,
  e: { event_type: string; extra?: Record<string, unknown>; at?: string; restricted?: true },
) {
  const state = stateOf(process);
  // Places left, on an event with a limit only: what the wire's
  // remainingAttendeeCapacity says.
  const going = state.capacity ? await eventStore.get().goingCount(process.id) : undefined;
  await emitEvent({
    event_type: e.event_type,
    actor,
    process_id: process.id,
    jurisdiction: process.jurisdiction,
    processType: TYPE,
    action_url_path: `/events/${process.id}`,
    data: { process: eventBlock(process.title, process.description, state, going), ...e.extra },
    ...(e.at ? { timestamp: e.at } : {}),
    ...(e.restricted ? { visibility: "restricted" as const } : {}),
  });
}

/**
 * Tell the people going (Events 2, E2), and log it on the event: the hub
 * sends, through its mail guard, to whoever has not unsubscribed. Run after
 * the action commits, so a refused or retried action tells nobody; a failure
 * to send is logged and never undoes what was done.
 */
async function tellGoing(
  process: Process,
  m: { kind: "announcement" | "change"; sender: string; subject: string; body: string },
): Promise<void> {
  const store = eventStore.get();
  const accounts = (await store.goingAccounts(process.id)).filter((a) => a !== m.sender);
  let report = { sent: 0, held_back: 0 };
  if (accounts.length > 0) {
    try {
      report = await notify(process.id, accounts, { subject: m.subject, text: m.body });
    } catch (err) {
      console.error(`[events] telling the people going to ${process.id} failed:`, err);
    }
  }
  await store.logAnnouncement({ process_id: process.id, ...m, recipients: accounts.length, sent: report.sent, held_back: report.held_back });
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
    image_url: state.image?.url ?? null,
    image_alt: state.image?.alt || null,
    time_zone: state.time_zone ?? null,
    capacity: state.capacity ?? null,
  });
}

async function attendance(process: Process) {
  return { attendance: { count: await eventStore.get().goingCount(process.id) } };
}

/** The announcement log, for a reader who is going or made it; null for anyone else. */
async function announcementsFor(process: Process, actor?: string): Promise<unknown[] | null> {
  if (!actor) return null;
  if (actor !== process.createdBy && !(await eventStore.get().isGoing(process.id, actor))) return null;
  const rows = await eventStore.get().announcements(process.id);
  return rows.map(({ sender: _sender, recipients: _r, sent: _s, held_back: _h, ...row }) =>
    actor === process.createdBy ? { ...row, recipients: _r, sent: _s, held_back: _h } : row,
  );
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
      const state: EventState = {
        ...times,
        location: checkLocation(input.location),
        cancelled: null,
        // 0.3.0: its own zone (the hub's when the form sent none), its
        // picture and its limit, each only when set.
        time_zone: timeZoneOf(input.time_zone) ?? hubContext().timeZone,
      };
      const image = input.image as { url?: unknown; alt?: unknown } | null | undefined;
      const picture = imageOf(image?.url, image?.alt);
      if (picture) state.image = picture;
      const capacity = capacityOf(input.capacity);
      if (capacity) state.capacity = capacity;
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
        // Its people going are told on their own (Events 2, 5).
        const cancelled = structuredClone(process);
        await afterActionCommits(() =>
          tellGoing(cancelled, {
            kind: "change",
            sender: "system",
            subject: `Cancelled: ${cancelled.title}`,
            body: [`${cancelled.title} on ${whenText(state.start_time, state.end_time, zoneOf(state))} is cancelled.`, reason ? `Why: ${reason}` : ""]
              .filter(Boolean)
              .join("\n\n"),
          }),
        );
        return { status: "cancelled" };
      }
      case "going": {
        const added = await eventStore.get().addGoing(process.id, action.actor);
        if (added === "full") throw new ConflictError(`This event is full: ${state.capacity} people are going.`, "event_full");
        if (added === "already") return { status: "going", changed: false };
        await emit(process, action.actor, { event_type: "civic.event.going", extra: await attendance(process) });
        return { status: "going", changed: true };
      }
      case "not_going": {
        if (!(await eventStore.get().removeGoing(process.id, action.actor))) return { status: "not_going", changed: false };
        await emit(process, action.actor, { event_type: "civic.event.not_going", extra: await attendance(process) });
        return { status: "not_going", changed: true };
      }
      case "announce": {
        // To everyone going, from its creator or an admin (the descriptor's
        // callers). The event records that one was sent and to how many; the
        // words stay in the announcement log, for the people going.
        const subject = typeof action.payload.subject === "string" ? action.payload.subject.trim() : "";
        const message = typeof action.payload.message === "string" ? action.payload.message.trim() : "";
        if (!subject || subject.length > SUBJECT_MAX) throw new ValidationError(`Give the message a subject of at most ${SUBJECT_MAX} characters.`, "subject_invalid");
        if (!message || message.length > MESSAGE_MAX) throw new ValidationError(`Write a message of at most ${MESSAGE_MAX} characters.`, "message_invalid");
        const recipients = (await eventStore.get().goingAccounts(process.id)).filter((a) => a !== action.actor).length;
        await emit(process, action.actor, { event_type: EVENTS.announced, extra: { announcement: { recipients } }, restricted: true });
        const snapshot = structuredClone(process);
        await afterActionCommits(() => tellGoing(snapshot, { kind: "announcement", sender: action.actor, subject, body: message }));
        return { status: "announced", recipients };
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
    return {
      editable: true,
      locked_fields: [],
      admins_edit: true,
      state_fields: ["start_time", "end_time", "location", "time_zone", "image", "capacity"],
    };
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
    const before = structuredClone(stateOf(process));
    const state = stateOf(edited);
    for (const key of ["start_time", "end_time", "location", "time_zone", "image", "capacity"] as const) {
      if (key in changes.current) (state as unknown as Record<string, unknown>)[key] = changes.current[key];
    }
    await writeIndex(edited);
    await emit(edited, editor?.id ?? process.createdBy, { event_type: "civic.event.updated", extra: { edit: { changed_fields: changes.changed_fields } } });
    // A new time or place: its people going are told what changed (Events 2, 5).
    const changed = changeText(before, state);
    if (changed) {
      await tellGoing(edited, {
        kind: "change",
        sender: "system",
        subject: `Changed: ${edited.title}`,
        body: `${edited.title} has changed.\n\n${changed}`,
      });
    }
  },

  // The hub's "processes you support were edited" notice (in the hub, for
  // whoever is not on email): an event someone is going to is one they support.
  async listSupportedBy(userId: string): Promise<string[]> {
    return eventStore.get().goingTo(userId);
  },

  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const state = stateOf(process);
    const going = await eventStore.get().goingCount(process.id);
    const capacity = state.capacity ?? null;
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
      time_zone: zoneOf(state),
      image: state.image ?? null,
      // Full is how many are going, not a status: one leaving opens a place.
      capacity,
      spots_left: capacity === null ? null : Math.max(0, capacity - going),
      going_count: going,
      is_going: actor ? await eventStore.get().isGoing(process.id, actor) : false,
      // Whether the reader made it (never whose it is): its creator may edit or cancel it.
      is_creator: Boolean(actor) && actor === process.createdBy,
      // What its people going were sent (Events 2, 5): to them and its
      // creator only; admins read them at /calendar/events/:id/announcements.
      announcements: await announcementsFor(process, actor),
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
      image_url: state.image?.url ?? null,
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
