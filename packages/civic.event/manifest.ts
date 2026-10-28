// Events: the hub's calendar, as a process type. Plain data the hub's server
// and its UI both read (docs/BUILD-A-PLUGIN.md walks through every field).

import { defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";

export const TYPE = "civic.event";

/** The event types it writes, each its own (an AS2 activity on the wire, below). */
export const EVENTS = {
  published: "civic.event.published",
  updated: "civic.event.updated",
  cancelled: "civic.event.cancelled",
  going: "civic.event.going",
  notGoing: "civic.event.not_going",
  announced: "civic.event.announced",
} as const;

const EMITS = [EVENTS.published, EVENTS.updated, EVENTS.cancelled, EVENTS.going, EVENTS.notGoing, EVENTS.announced, "civic.process.ended"];

/** The tables it keeps (its grant, its schema check, its declarations). */
const TABLES = ["calendar_events", "calendar_attendance", "calendar_drafts", "calendar_announcements"];

/**
 * An event on the hub's calendar. A resident drafts one and it goes through
 * the hub's review (an admin's, or a demo hub's at once); approval publishes
 * it. While it is upcoming ("active") residents say they are going, its
 * creator or an admin edits or cancels it, and at its end time the hub marks
 * it past ("closed"). A cancelled event is closed too, and stays on the
 * calendar marked cancelled. Its creator or an admin may write to everyone
 * going ("announce"); a change of time or place, or a cancellation, tells
 * them on its own. An event may have a limit; at it, "going" is refused.
 *
 * Not retry-safe: publish, edit, cancel and close also write the calendar's
 * row, going and not going an attendance row.
 */
/** The digest's line under a new event's title: its time and place (data.process.event). */
function digestLine(data: Record<string, unknown>): string | null {
  const ev = (data as { process?: { event?: { start_time?: unknown; location?: { name?: unknown } } } }).process?.event;
  const when = typeof ev?.start_time === "string" ? new Date(ev.start_time).toUTCString().replace(/:\d\d GMT$/, " UTC") : "";
  const where = typeof ev?.location?.name === "string" ? ev.location.name : "";
  return [when, where].filter(Boolean).join(" · ") || "A new event is on the calendar.";
}

const descriptor = defineDescriptor({
  type: TYPE,
  version: "0.1",
  tier: 1,
  plugin: "events",
  states: ["active", "closed"],
  initial_status: "active",
  actions: [
    {
      name: "publish",
      description: "Put an approved event on the calendar",
      callers: ["admin", "system"],
      from: ["pending_review"],
      to: "active",
      emits: [EVENTS.published],
      // The calendar row is written after the action commits (A2).
      retry_safe: true,
    },
    {
      name: "cancel",
      description: "Cancel an upcoming event; it stays on the calendar marked cancelled",
      callers: ["creator", "admin"],
      from: ["active"],
      to: "closed",
      emits: [EVENTS.cancelled],
      retry_safe: true,
      input_schema: {
        type: "object",
        properties: { reason: { type: "string" } },
        examples: [{ reason: "The room is no longer available." }],
      },
    },
    {
      name: "going",
      description: "Say you are going; saying it again changes nothing",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.going],
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      name: "not_going",
      description: "Take back that you are going",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.notGoing],
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      name: "announce",
      description: "Send a message to everyone going (by email, through the hub; logged on the event)",
      callers: ["creator", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.announced],
      input_schema: {
        type: "object",
        properties: { subject: { type: "string" }, message: { type: "string" } },
        required: ["subject", "message"],
        examples: [{ subject: "Bring a chair", message: "We have fewer seats than people going. Bring a folding chair if you can." }],
      },
    },
    {
      name: "close",
      description: "Mark the event past at its end time",
      callers: ["system"],
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended"],
      retry_safe: true,
    },
  ],
  emits: EMITS,
  // Officials publish directly, as admins do (engine 2, A6; Adam, 2026-10-27).
  creation: { resident: { drafts: "/calendar/drafts", publish_at_once: ["official"] }, admin: false, system: false },
  deadline: { action: "close", source: "state.end_time" },
  brief: false,
  tables: TABLES,
  outside_services: [],
  examples: {
    draft: {
      title: "Conformance event",
      description: "An evening to meet the neighbours.",
      start_time: "2030-06-01T17:00:00Z",
      end_time: "2030-06-01T19:00:00Z",
      venue: "Community room",
      capacity: 40,
    },
  },
  display: {
    label: "Event",
    plural: "Events",
    icon: "calendar",
    section: { id: "events", label: "Events", path: "/events", detail_paths: ["/events/"], order: 33 },
  },
});

// The event itself, always an AS2 Event: its time and place lifted from the
// payload (wireObject, below).
const ACTIVITY_OBJECT = { kind: "civic", class: "Event", id: "process", name: "title" } as const;

export const EVENT_MANIFEST = defineManifest({
  descriptor,
  color: "event",
  detailPath: (id) => `/events/${id}`,
  requiredSchema: [
    {
      table: "calendar_events",
      columns: ["process_id", "title", "start_time", "end_time", "location", "cancelled", "archived", "image_url", "image_alt", "time_zone", "capacity"],
      owner: TYPE,
    },
    { table: "calendar_attendance", columns: ["process_id", "user_id"], owner: TYPE },
    { table: "calendar_announcements", columns: ["id", "process_id", "kind", "sender", "subject", "body", "recipients", "sent", "held_back"], owner: TYPE },
  ],
  tables: [
    {
      name: "calendar_events",
      rows: "export",
      key: ["process_id"],
      holds: "the hub's calendar: each published event's title, time and place",
      sample: { child: ["process_id"], notParticipation: "the event's place on the calendar, written by the event itself" },
    },
    {
      name: "calendar_attendance",
      rows: "export",
      key: ["process_id", "user_id"],
      holds: "who said they are going to each event",
      sample: { child: ["process_id"], participation: { user: "user_id", kind: "going", nouns: ["person going to an event", "people going to events"] } },
    },
    {
      name: "calendar_drafts",
      rows: "export",
      key: ["id"],
      holds: "residents' unfinished event drafts",
      sample: { notContent: "a resident's unsubmitted event draft; the seed writes none" },
    },
    {
      name: "calendar_announcements",
      rows: "export",
      key: ["id"],
      holds: "messages sent to the people going to each event, and what changed, with how many each reached",
      sample: { child: ["process_id"], notParticipation: "a message to the people going, sent by the creator, an admin or the hub" },
    },
  ],
  // Its picture (Events 2, E1): the hub's upload route takes one for it.
  uploads: { images: true },
  jobs: [],
  pluginSection: {
    order: 35,
    name: "Events",
    what: "A calendar: residents propose events, say they're going, and anyone can subscribe.",
    fields: [],
    help: {
      text: "A calendar. People propose events, which go through review like proposals, and say they're going. Anyone can subscribe to the calendar in their own calendar app. Off hides the Events pages; nothing is deleted.",
      page: "/reference/plugins",
      anchor: "plugins-events",
      pending: true,
    },
  },
  // On the wire each is an AS2 activity on the event, as Mobilizon and other
  // fediverse servers publish them: Create, Update (a cancellation carries
  // ical:status CANCELLED), Join and Leave.
  activities: {
    [EVENTS.published]: { type: "Create", object: ACTIVITY_OBJECT },
    [EVENTS.updated]: { type: "Update", object: ACTIVITY_OBJECT },
    [EVENTS.cancelled]: { type: "Update", object: ACTIVITY_OBJECT },
    [EVENTS.going]: { type: "Join", object: ACTIVITY_OBJECT },
    [EVENTS.notGoing]: { type: "Leave", object: ACTIVITY_OBJECT },
    // To the people going, never public (restricted: the admins' audience on
    // the wire); the message itself stays in the announcement log.
    [EVENTS.announced]: { type: "Create", object: { kind: "note" } },
  },
  // The process object is an AS2 Event whenever the payload carries its time
  // (every event this type writes; the hub's own created and status events
  // stay civic:Process). Everything lifted is under `process`, always public.
  wireObject: {
    type: "Event",
    properties: {
      summary: "process.event.summary",
      content: "process.event.description",
      startTime: "process.event.start_time",
      endTime: "process.event.end_time",
      location: "process.event.location",
      "ical:status": "process.event.status",
      // Events 0.3.0, each only on events that set it: its picture (AS2;
      // Mobilizon reads it as the banner), its time zone and its limit, in
      // the terms Mobilizon publishes them in.
      image: "process.event.image",
      timezone: "process.event.time_zone",
      maximumAttendeeCapacity: "process.event.capacity",
      remainingAttendeeCapacity: "process.event.remaining_capacity",
    },
    requires: ["startTime"],
    contexts: {
      mz: "https://mobilizon.org/ns#",
      sc: "http://schema.org/",
      timezone: { "@id": "mz:timezone", "@type": "sc:Text" },
      maximumAttendeeCapacity: "sc:maximumAttendeeCapacity",
      remainingAttendeeCapacity: "sc:remainingAttendeeCapacity",
    },
  },
  // One card when an event goes on the calendar; none for a cancel or an RSVP.
  // Its card kind is its own (engine 2, A5): a rose apart from meeting-green,
  // and the digest's "New events" with the time and place under the title.
  feed: {
    cards: [
      { event: EVENTS.published, match: "event", card: { surface: "activity", kind: "event", color: "event", pill: "Event", href: "detail" } },
    ],
    kinds: [
      {
        kind: "event",
        color: { key: "event", fg: "#8a2456", bg: "#f6e3ec", label: "Events" },
        digest: { section: "events", heading: "New events", summary: digestLine },
      },
    ],
  },
  // Who is going: names to signed-in members, the count to everyone.
  disclosure: "members",
  publicPayload: {
    [EVENTS.going]: ["attendance"],
    [EVENTS.notGoing]: ["attendance"],
    [EVENTS.cancelled]: ["cancellation"],
    // Restricted, so off every public stream; nothing of it is public either way.
    [EVENTS.announced]: [],
  },
  deadlineRefusal: { code: "event_past", message: "This event has ended." },
  // What the hub's analytics counts (ADR-016): saying you're going is taking
  // part. An event closes at its end or when it is cancelled, and produces no
  // result, as a proposal does not.
  participation: {
    participation: [EVENTS.going],
    creation: ["civic.process.created"],
    closing: ["civic.process.ended", EVENTS.cancelled],
    outcome: [],
    // Taking back "going", and a change to the event, are acts, not taking
    // part (engine 2, E17): accounted for, counted as nothing.
    // A message to the people going (Events 2) is the organiser's act, not
    // taking part, and is counted as nothing too.
    withdrawal: [EVENTS.notGoing, EVENTS.updated, EVENTS.announced],
  },
  // Its own words for where an event is (A4): the hub's status stays active
  // or closed, which the descriptor and the wire serve.
  statuses: {
    declared: [
      { id: "scheduled", label: "Scheduled", hub: "active" },
      { id: "past", label: "Past", hub: "closed" },
      { id: "cancelled", label: "Cancelled", hub: "closed" },
    ],
    of: (p) => (p.state.cancelled ? "cancelled" : p.status === "closed" ? "past" : "scheduled"),
  },
  capabilities: {
    activities: { emit: EMITS, listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: TABLES },
    // Its picture through the hub's store (E1); messages to the people going
    // through the hub's mail (notify, E2).
    adapters: ["objectStore", "mail"],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "create-page", "feed-card", "nav-section"] },
  },
});

export default EVENT_MANIFEST;
