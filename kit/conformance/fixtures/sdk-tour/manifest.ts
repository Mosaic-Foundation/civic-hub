// The SDK tour's manifest: plain data. A fixture that uses every capability of
// SDK v1 so the conformance suite can prove an outside package can.

import { DEADLINE_CLOSE_INPUT, defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";

export const TYPE = "example.sdk_tour";

export const EVENTS = {
  marked: "example.sdk_tour.marked",
  joined: "example.sdk_tour.joined",
  endorsed: "example.sdk_tour.endorsed",
} as const;

const EMITS = [EVENTS.marked, EVENTS.joined, EVENTS.endorsed, "civic.process.ended"];
const TABLES = ["sdk_tour_drafts", "sdk_tour_marks", "sdk_tour_joins", "sdk_tour_places"];

const descriptor = defineDescriptor({
  type: TYPE,
  version: "0.1",
  tier: 1,
  plugin: "sdk_tour",
  states: ["active", "closed"],
  initial_status: "active",
  actions: [
    {
      // A2: its own-table write happens after the action commits.
      name: "mark",
      description: "Mark the tour; marking it again is refused",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.marked],
      retry_safe: true,
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      // A3: who joined is shown by the hub's disclosure policy.
      name: "join",
      description: "Join the tour; joining again changes nothing",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.joined],
      input_schema: { type: "object", properties: {}, examples: [{}] },
    },
    {
      // A6: an official may endorse.
      name: "endorse",
      description: "An official endorses the tour",
      callers: ["official", "admin"],
      from: ["active"],
      to: null,
      emits: [EVENTS.endorsed],
      input_schema: {
        type: "object",
        properties: { note: { type: "string", maxLength: 500 } },
        examples: [{ note: "Worth doing." }],
      },
    },
    {
      name: "close",
      description: "Close the tour at its deadline",
      callers: ["admin", "system"],
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended"],
      retry_safe: true,
      input_schema: DEADLINE_CLOSE_INPUT,
    },
  ],
  emits: EMITS,
  // A6: officials publish directly, as admins do.
  creation: { resident: { drafts: "/sdk-tour/drafts", publish_at_once: ["official"] }, admin: false, system: false },
  deadline: { action: "close", source: "state.closes_at" },
  brief: false,
  tables: TABLES,
  outside_services: [],
  examples: {
    draft: {
      title: "Conformance tour",
      description: "A walk through everything the SDK offers.",
      place: "Town hall",
    },
  },
  display: {
    label: "SDK tour",
    plural: "SDK tours",
    icon: "map",
    section: { id: "sdk-tours", label: "Tours", path: "/sdk-tour", detail_paths: ["/sdk-tour/"], order: 90 },
  },
});

const ACTIVITY_OBJECT = { kind: "civic", class: "civic:Process", id: "process", name: "title" } as const;

export const SDK_TOUR_MANIFEST = defineManifest({
  descriptor,
  color: "sdk-tour",
  detailPath: (id) => `/sdk-tour/${id}`,
  requiredSchema: [
    { table: "sdk_tour_marks", columns: ["process_id", "user_id"], owner: TYPE },
    { table: "sdk_tour_joins", columns: ["process_id", "user_id"], owner: TYPE },
    { table: "sdk_tour_places", columns: ["process_id", "place"], owner: TYPE },
  ],
  tables: [
    // B9: what each table is to sample content, from the folder alone.
    { name: "sdk_tour_drafts", rows: "export", key: ["id"], holds: "residents' unfinished tour drafts", sample: { notContent: "an unsubmitted draft; the seed writes none" } },
    {
      name: "sdk_tour_marks",
      rows: "export",
      key: ["process_id", "user_id"],
      holds: "who marked each tour",
      sample: { child: ["process_id"], participation: { user: "user_id", kind: "mark", nouns: ["mark on a tour", "marks on tours"] } },
    },
    {
      name: "sdk_tour_joins",
      rows: "export",
      key: ["process_id", "user_id"],
      holds: "who joined each tour",
      sample: { child: ["process_id"], participation: { user: "user_id", kind: "join", nouns: ["person on a tour", "people on tours"] } },
    },
    {
      name: "sdk_tour_places",
      rows: "export",
      key: ["process_id"],
      holds: "each tour's place as last edited",
      sample: { child: ["process_id"], notParticipation: "written by the tour's own edits" },
    },
  ],
  jobs: [],
  pluginSection: {
    order: 90,
    name: "SDK tour",
    what: "A conformance fixture that uses every SDK v1 capability.",
    fields: [],
    help: { text: "A fixture: every SDK v1 capability in one type.", page: "/reference/plugins", anchor: "plugins-sdk-tour", pending: true },
  },
  activities: {
    [EVENTS.marked]: { type: "Add", object: ACTIVITY_OBJECT },
    [EVENTS.joined]: { type: "Join", object: ACTIVITY_OBJECT },
    [EVENTS.endorsed]: { type: "Like", object: ACTIVITY_OBJECT },
  },
  // A5: its own card kind and colour, on its created event.
  feed: {
    cards: [
      { event: "civic.process.created", card: { surface: "activity", kind: "sdk-tour", color: "sdk-tour", pill: "SDK tour", href: "detail" } },
    ],
    kinds: [
      {
        kind: "sdk-tour",
        color: { key: "sdk-tour", fg: "#4a3b8c", bg: "#ebe7f6", label: "SDK tour" },
        digest: { section: "sdk_tour", heading: "SDK tour" },
      },
    ],
  },
  // A3: names to signed-in members, the count to everyone.
  disclosure: "members",
  publicPayload: { [EVENTS.joined]: ["joined"], [EVENTS.endorsed]: ["endorsement"] },
  deadlineRefusal: { code: "sdk_tour_closed", message: "This tour has closed." },
  participation: {
    participation: [EVENTS.joined, EVENTS.marked, EVENTS.endorsed],
    creation: ["civic.process.created"],
    closing: ["civic.process.ended"],
    outcome: [],
    withdrawal: [],
  },
  // A4: its own words for the hub's two statuses.
  statuses: {
    declared: [
      { id: "open", label: "Open", hub: "active" },
      { id: "done", label: "Done", hub: "closed" },
    ],
    of: (p) => (p.status === "closed" ? "done" : "open"),
  },
  capabilities: {
    activities: { emit: EMITS, listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: TABLES },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "create-page", "feed-card"] },
  },
});

export default SDK_TOUR_MANIFEST;
