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
} as const;

const EMITS = [EVENTS.published, EVENTS.updated, EVENTS.cancelled, EVENTS.going, EVENTS.notGoing, "civic.process.ended"];

/**
 * An event on the hub's calendar. A resident drafts one and it goes through
 * the hub's review (an admin's, or a demo hub's at once); approval publishes
 * it. While it is upcoming ("active") residents say they are going, its
 * creator or an admin edits or cancels it, and at its end time the hub marks
 * it past ("closed"). A cancelled event is closed too, and stays on the
 * calendar marked cancelled.
 *
 * Not retry-safe: publish, edit, cancel and close also write the calendar's
 * row, going and not going an attendance row.
 */
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
    },
    {
      name: "edit",
      description: "Change when or where an upcoming event is",
      callers: ["creator", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.updated],
      input_schema: {
        type: "object",
        properties: {
          start_time: { type: "string" },
          end_time: { type: "string" },
          location: { type: "object" },
        },
        examples: [{ end_time: "2030-06-01T20:00:00Z" }],
      },
    },
    {
      name: "cancel",
      description: "Cancel an upcoming event; it stays on the calendar marked cancelled",
      callers: ["creator", "admin"],
      from: ["active"],
      to: "closed",
      emits: [EVENTS.cancelled],
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
      name: "close",
      description: "Mark the event past at its end time",
      callers: ["system"],
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended"],
    },
  ],
  emits: EMITS,
  creation: { resident: { drafts: "/calendar/drafts" }, admin: false, system: false },
  deadline: { action: "close", source: "state.end_time" },
  brief: false,
  tables: ["calendar_events", "calendar_attendance", "calendar_drafts"],
  outside_services: [],
  examples: {
    draft: {
      title: "Conformance event",
      description: "An evening to meet the neighbours.",
      start_time: "2030-06-01T17:00:00Z",
      end_time: "2030-06-01T19:00:00Z",
      venue: "Community room",
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
    { table: "calendar_events", columns: ["process_id", "title", "start_time", "end_time", "location", "cancelled", "archived"], owner: TYPE },
    { table: "calendar_attendance", columns: ["process_id", "user_id"], owner: TYPE },
  ],
  tables: [
    { name: "calendar_events", rows: "export", key: ["process_id"], holds: "the hub's calendar: each published event's title, time and place" },
    { name: "calendar_attendance", rows: "export", key: ["process_id", "user_id"], holds: "who said they are going to each event" },
    { name: "calendar_drafts", rows: "export", key: ["id"], holds: "residents' unfinished event drafts" },
  ],
  jobs: [],
  pluginSection: { order: 35, name: "Events", what: "A calendar: residents propose events, say they're going, and anyone can subscribe.", fields: [] },
  // On the wire each is an AS2 activity on the event, as Mobilizon and other
  // fediverse servers publish them: Create, Update (a cancellation carries
  // ical:status CANCELLED), Join and Leave.
  activities: {
    [EVENTS.published]: { type: "Create", object: ACTIVITY_OBJECT },
    [EVENTS.updated]: { type: "Update", object: ACTIVITY_OBJECT },
    [EVENTS.cancelled]: { type: "Update", object: ACTIVITY_OBJECT },
    [EVENTS.going]: { type: "Join", object: ACTIVITY_OBJECT },
    [EVENTS.notGoing]: { type: "Leave", object: ACTIVITY_OBJECT },
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
    },
    requires: ["startTime"],
  },
  // One card when an event goes on the calendar; none for a cancel or an RSVP.
  feed: {
    cards: [
      { event: EVENTS.published, match: "event", card: { surface: "activity", kind: "event", color: "event", pill: "Event", href: "detail" } },
    ],
  },
  // Who is going: names to signed-in members, the count to everyone.
  disclosure: "members",
  publicPayload: {
    [EVENTS.going]: ["attendance"],
    [EVENTS.notGoing]: ["attendance"],
    [EVENTS.cancelled]: ["cancellation"],
  },
  deadlineRefusal: { code: "event_past", message: "This event has ended." },
  // What the hub's analytics counts (ADR-016): saying you're going is taking
  // part (taking it back is not a second act); an event closes at its end or
  // when it is cancelled, and produces no result, as a proposal does not.
  participation: {
    participation: [EVENTS.going],
    creation: ["civic.process.created"],
    closing: ["civic.process.ended", EVENTS.cancelled],
    outcome: [],
  },
  capabilities: {
    activities: { emit: EMITS, listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: ["calendar_events", "calendar_attendance", "calendar_drafts"] },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "create-page", "feed-card", "nav-section"] },
  },
});

export default EVENT_MANIFEST;
