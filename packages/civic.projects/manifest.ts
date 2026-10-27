// project: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.

import { defineDescriptor, defineManifest } from "../../src/processes/manifest.js";

/**
 * What a project is (src/processes/descriptor.ts). Residents say whether they
 * support or oppose it while it is active; its creator (or an admin) marks it
 * complete, which closes it and makes its brief. It has no deadline.
 *
 * Its creation is announced as civic.project.created and its completion as
 * civic.project.updated.
 */
/** The views a resident may hold on an active project. */
export const SENTIMENTS = ["support", "oppose", "neutral"] as const;

const descriptor = defineDescriptor({
  type: "civic.project",
  version: "0.1",
  tier: 1,
  plugin: "project",
  states: ["active", "closed"],
  initial_status: "active",
  actions: [
    {
      name: "process.sentiment",
      description: "Support or oppose an active project, or clear your view",
      callers: ["resident", "admin"],
      from: ["active"],
      to: null,
      emits: ["civic.project.sentiment_changed"],
      input_schema: {
        type: "object",
        properties: { sentiment: { enum: [...SENTIMENTS] } },
        required: ["sentiment"],
        examples: [{ sentiment: "support" }],
      },
    },
    {
      name: "process.complete",
      description: "Mark the project complete; it closes and its brief goes to review",
      callers: ["creator", "admin"],
      from: ["active"],
      to: "closed",
      emits: ["civic.project.updated"],
      // Its only other effect, the projects row's copy of the status, is
      // written after the process row commits.
      retry_safe: true,
    },
  ],
  emits: ["civic.project.created", "civic.project.updated", "civic.project.sentiment_changed"],
  creation: { resident: { drafts: "/projects/drafts" }, admin: false, system: false },
  deadline: null,
  brief: true,
  tables: ["projects", "project_sentiments", "project_drafts"],
  outside_services: [],
  examples: {
    draft: { title: "Conformance project", description: "Something residents are doing." },
  },
  display: {
    label: "Project",
    plural: "Projects",
    icon: "project",
    section: { id: "projects", label: "Projects", path: "/projects", detail_paths: ["/project/"], order: 40 },
  },
});

export const PROJECT_MANIFEST = defineManifest({
  descriptor,
  color: "project",
  detailPath: (id) => `/project/${id}`,
  requiredSchema: [
    { table: "projects", owner: "civic.projects" },
    { table: "project_sentiments", owner: "civic.projects" },
  ],
  tables: [
    { name: "projects", rows: "export", key: ["id"], holds: "projects" },
    { name: "project_sentiments", rows: "export", key: ["project_id", "user_id"], holds: "how residents feel about each project" },
    { name: "project_drafts", rows: "export", key: ["id"], holds: "residents' unfinished project drafts" },
    { name: "project_updates", rows: "export", key: ["id"], legacy: true, holds: "older project updates" },
    { name: "project_comments", rows: "export", key: ["id"], legacy: true, holds: "older project comments" },
  ],
  jobs: [],
  pluginSection: {
 order: 30,
 name: "Projects",
 what: "Community projects with updates, comments and sentiment.", fields: [] },
  activities: {
    "civic.project.created": { type: "Create", object: { kind: "civic", class: "hub:Project", id: "process", name: "title" } },
    "civic.project.updated": { type: "Update", object: { kind: "civic", class: "hub:Project", id: "process" } },
    "civic.project.sentiment_changed": { type: "Update", object: { kind: "civic", class: "hub:ProjectSentiment", id: "process" } },
  },
  legacyActivities: {
    // Before comments moved to the shared comment module (2026-09-06).
    "civic.project.comment_added": { type: "Create", object: { kind: "note" } },
    "civic.project.archived": { type: "civic:End", object: { kind: "process", terminalState: "archived" } },
  },
  // What hub:payload carries publicly, per event (Architecture 3, ADR-010).
  // Who a participant's name is disclosed to (Architecture 3, Q6: Adam, 2026-10-21).
  disclosure: "members",
  // What the hub's analytics counts (ADR-016): a project is working with
  // neighbours on something.
  participation: {
    participation: ["civic.project.sentiment_changed"],
    creation: ["civic.project.created"],
    closing: ["civic.project.updated"],
    outcome: [],
    measures: { worked_with_neighbours: "participation" },
  },
  publicPayload: {
    "civic.project.created": ["project"],
    "civic.project.updated": ["project", "edit"],
    "civic.project.sentiment_changed": ["project"],
    "civic.project.comment_added": ["project"],
  },
  feed: {
    cards: [
      { event: "civic.project.created", match: "event", card: { surface: "activity", kind: "project-created", color: "project", pill: "New project", href: "action_url" } },
      { event: "civic.project.updated", match: "event", card: { surface: "activity", kind: "project-updated", color: "project", pill: "Project update", href: "action_url" } },
    ],
    brief: { color: "project", noun: "project", pill: "Project completed" },
  },
  capabilities: {
    activities: { emit: ["civic.project.created", "civic.project.updated", "civic.project.sentiment_changed"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: ["projects", "project_sentiments", "project_drafts", "project_updates", "project_comments"] },
    adapters: [],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "create-page", "feed-card", "nav-section"] },
  },
});

export default PROJECT_MANIFEST;
