// civic.project process handler — thin adapter around the civic.projects module.
//
// A Project is a resident- or org-run initiative with updates, comments, and
// support/oppose sentiment. Its relational `projects` table carries the rich
// read model served by the /projects routes.
//
// One action path (2026-10-12): sentiment and Complete run through
// executeAction like every other type's actions, so Complete changes status
// through transition_process and its brief comes from the universal seam. The
// /projects routes are thin wrappers over executeAction. The `projects` row
// keeps its own copy of the status, written after the process row commits.

import { ValidationError } from "../errors/index.js";
import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import type { ProcessTypeDescriptor } from "./descriptor.js";
import { afterActionCommits } from "../services/actionScope.js";
import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { validateLinkSet } from "../modules/civic.process_links/index.js";
import {
  createProject,
  getProject,
  listProjectUpdates,
  setProjectSentiment,
  markProjectCompleted,
  getProjectReadModel,
  type SentimentValue,
} from "../modules/civic.projects/index.js";
import { emitProjectCompleted, emitProjectUpdated } from "../modules/civic.projects/events.js";
import { emitEvent } from "../events/eventEmitter.js";
import type { BriefContent } from "../modules/civic.brief/index.js";
import { projectAssistantConfig } from "./projectAssistantConfig.js";
import { createDraft, setDraftStatus, updateDraft } from "../modules/civic.drafts/index.js";
import { projectDraftKind } from "./draftKinds.js";
import { readAll } from "../db/readAll.js";
import { hubKindOf, participantNoun } from "../shared/hubKind.js";
import { getSettingSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";

// What the people taking part are called on this hub (review R29, 2026-10-07).
const hubNoun = (n: number): string =>
  participantNoun(hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)), n, getSettingSync(KEYS.COPY_RESIDENT_NOUN));

function db() {
  return forHub(currentHubId());
}

const SENTIMENTS = ["support", "oppose", "neutral"] as const;

/**
 * What a project is (src/processes/descriptor.ts). Residents say whether they
 * support or oppose it while it is active; its creator (or an admin) marks it
 * complete, which closes it and makes its brief. It has no deadline.
 *
 * Its creation is announced as civic.project.created and its completion as
 * civic.project.updated.
 */
export const PROJECT_DESCRIPTOR: ProcessTypeDescriptor = {
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
};

const projectAdapter: ProcessHandler = {
  type: "civic.project",
  descriptor: PROJECT_DESCRIPTOR,
  detailPath: (id: string) => `/project/${id}`,
  draftPath: (draftId: string) => `/projects/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => setDraftStatus(projectDraftKind.spec, draftId, "drafting"),

  // Creator edits (the only type that allows them — Adam, 2026-09-03):
  // while the project is active; the title locks once anyone supports it,
  // because the title is what people endorsed.
  editPolicy: async (process) => {
    const row = await db()
      .from("projects")
      .select<{ status?: string }>("status")
      .eq("id", process.id)
      .maybeSingle();
    const status = row?.status;
    if (status !== "active") {
      return { editable: false, locked_fields: [], reason: "Only an active project can be edited." };
    }
    const count = await db()
      .from("project_sentiments")
      .count()
      .eq("project_id", process.id)
      .eq("sentiment", "support");
    return { editable: true, locked_fields: count > 0 ? ["title"] : [] };
  },
  listSupporters: async (processId) => {
    // Paged: a project can have more than 1,000 supporters (PostgREST's cap).
    const rows = await readAll((from, to) =>
      db()
        .from("project_sentiments")
        .select<{ user_id: string }>("user_id")
        .eq("project_id", processId)
        .eq("sentiment", "support")
        .order("user_id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => r.user_id);
  },
  draftFromProcess: async (process, editorId, links) => {
    const project = await getProject(process.id);
    const content = (process.content ?? {}) as Record<string, unknown>;
    const draft = await createDraft(projectDraftKind.spec, editorId);
    await updateDraft(projectDraftKind.spec, draft.id, {
      title: process.title,
      description: project?.description ?? process.description ?? "",
      sources: (project?.sources ?? (content.sources as string[] | undefined) ?? []).join("\n"),
      banner_image_url: project?.banner_image_url ?? (content.banner_image_url as string | null) ?? null,
      banner_image_alt: project?.banner_image_alt ?? (content.banner_image_alt as string | null) ?? null,
      links: validateLinkSet(process.id, links),
    });
    return draft.id;
  },
  syncDraftFromProcess: async (draftId, process, links) => {
    const project = await getProject(process.id);
    const content = (process.content ?? {}) as Record<string, unknown>;
    await updateDraft(projectDraftKind.spec, draftId, {
      title: process.title,
      description: project?.description ?? process.description ?? "",
      sources: (project?.sources ?? (content.sources as string[] | undefined) ?? []).join("\n"),
      banner_image_url: project?.banner_image_url ?? (content.banner_image_url as string | null) ?? null,
      banner_image_alt: project?.banner_image_alt ?? (content.banner_image_alt as string | null) ?? null,
      links: validateLinkSet(process.id, links),
    });
    // Fresh start: no stale check result, and the check must run again.
    await db()
      .from("project_drafts")
      .update({ last_review_result: null, draft_modified_since_review: true, coc_checked_hash: null })
      .eq("id", draftId);
  },
  listSupportedBy: async (userId) => {
    const rows = await db()
      .from("project_sentiments")
      .select<{ project_id: string }>("project_id")
      .eq("user_id", userId)
      .eq("sentiment", "support");
    return rows.map((r) => r.project_id);
  },
  onEdited: async (process, changes) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const c = changes.current;
    if (typeof c.title === "string") patch.title = c.title;
    if (typeof c.description === "string") patch.description = c.description;
    if (Array.isArray(c.sources)) patch.sources = c.sources;
    if ("banner_image_url" in c) patch.banner_image_url = c.banner_image_url ?? null;
    if ("banner_image_alt" in c) patch.banner_image_alt = c.banner_image_alt ?? null;
    await db().from("projects").update(patch).eq("id", process.id);
  },

  getAssistantConfig: () => projectAssistantConfig,

  // A project update is stored by civic.input like any comment (word list,
  // admin hide); this is the project-specific meaning on top — the feed's
  // "Project update" card and the digest line read civic.project.updated.
  onUpdatePosted: async (process, update) => {
    await emitProjectUpdated({ project_id: process.id, emit: emitEvent }, update.actor, { update_id: update.id });
  },

  // The relational `projects` row holds project state; the canonical
  // `processes` row needs no type-specific state.
  initializeState(): Record<string, unknown> {
    return {};
  },

  // The projects row is created when the review is approved, keyed by the
  // canonical process id, so the processes row stays the permanent record.
  async onApproved(process: Process, creatorId: string): Promise<void> {
    const content = (process.content ?? {}) as Record<string, unknown>;
    await createProject(
      {
        id: process.id,
        title: process.title,
        description: process.description ?? "",
        sources: (content.sources as string[]) ?? [],
        user_id: creatorId,
        assistant_helped: (content.assistant_helped as boolean) ?? false,
        banner_image_url: (content.banner_image_url as string) ?? undefined,
        banner_image_alt: (content.banner_image_alt as string) ?? undefined,
      },
      emitEvent,
    );
  },

  async handleAction(process: Process, action: ProcessAction): Promise<Record<string, unknown>> {
    switch (action.type) {
      case "process.sentiment": {
        const sentiment = action.payload.sentiment;
        if (typeof sentiment !== "string" || !(SENTIMENTS as readonly string[]).includes(sentiment)) {
          throw new ValidationError(`sentiment must be one of: ${SENTIMENTS.join(", ")}`, "invalid_sentiment");
        }
        return setProjectSentiment(process.id, action.actor, sentiment as SentimentValue | "neutral", emitEvent);
      }
      case "process.complete": {
        process.status = "closed";
        await emitProjectCompleted({ project_id: process.id, emit: emitEvent }, action.actor);
        const id = process.id;
        await afterActionCommits(() => markProjectCompleted(id));
        return { status: "closed" };
      }
      default:
        throw new ValidationError(
          "That action isn't supported on a project.",
          "action_not_supported",
        );
    }
  },

  // The project page's own shape (GET /projects/:id reads it here too), so
  // an action's `view` is what the page shows. The owner is `created_by`,
  // which the service resolves to a byline and removes.
  async getReadModel(process: Process, actor?: string): Promise<Record<string, unknown>> {
    const model = await getProjectReadModel(process.id, actor);
    if (!model) {
      return { id: process.id, type: process.definition.type, title: process.title, status: process.status, created_by: process.createdBy };
    }
    const { user_id, ...rest } = model as Record<string, unknown>;
    return { ...rest, type: process.definition.type, created_by: (user_id as string | undefined) ?? process.createdBy };
  },

  getSummary(process: Process): Record<string, unknown> {
    return {
      id: process.id,
      type: process.definition.type,
      title: process.title,
      status: process.status,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
  },

  // Universal brief: a completed project's outcome is what it accomplished.
  // Seeds structure (community response, number of updates); the admin
  // writes the completion narrative into headline/summary during review.

  /**
   * The `projects` table carries its own status and its read model reads THAT
   * copy — so archiving only the processes row would hide the project from the
   * public list while /project/:id still rendered it as live.
   *
   * The child's PREVIOUS status is stashed into the archive metadata on the
   * way in, because the two vocabularies do not correspond: a process may be
   * `finalized` while its project row is `completed`, and nothing recovers one
   * from the other. Deriving it was the first version of this, and it silently
   * restored a closed proposal as `submitted` in the sibling handler.
   */
  async onArchive(process: Process): Promise<void> {
    const hubDb = db();
    const row = await hubDb
      .from("projects").select<{ status?: string }>("status").eq("id", process.id).maybeSingle();
    const previous = row?.status ?? "active";

    // Re-read: archiveProcess has already written state with its archive meta.
    const proc = await hubDb
      .from("processes").select<{ state: Record<string, unknown> }>("state").eq("id", process.id).maybeSingle();
    const state = { ...((proc?.state as Record<string, unknown>) ?? {}) };
    const archive = { ...((state.archive as Record<string, unknown>) ?? {}) };
    archive.child_previous_status = previous;
    state.archive = archive;

    await hubDb
      .from("processes").update({ state }).eq("id", process.id);
    process.state = state;

    await hubDb
      .from("projects")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", process.id);
  },

  async onRestore(
    _process: Process,
    _previousStatus: string,
    archiveMeta: Record<string, unknown> | null,
  ): Promise<void> {
    // Put the child row back exactly where it was, using the value onArchive
    // stashed. restoreProcess has already stripped state.archive by now, which
    // is why this arrives as an argument rather than off the process.
    const stashed = archiveMeta?.child_previous_status;
    const known = ["active", "completed"];
    const next =
      typeof stashed === "string" && known.includes(stashed) ? stashed : "active";

    await db()
      .from("projects")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", _process.id);
  },

  async generateBrief(process: Process): Promise<BriefContent | null> {
    const project = await getProject(process.id);
    if (!project) return null;
    const updates = await listProjectUpdates(process.id).catch(() => []);
    const weighedIn = project.support_count + project.oppose_count;

    const sections = [
      {
        heading: "Community response",
        body: `${project.support_count} in support · ${project.oppose_count} opposed.`,
      },
    ];
    if (updates.length > 0) {
      sections.push({
        heading: "Progress",
        body: `${updates.length} update${updates.length === 1 ? "" : "s"} posted over the life of the project.`,
      });
    }

    return {
      title: process.title,
      headline: "Project completed",
      summary: process.description ?? "",
      sections,
      participation_label:
        weighedIn > 0 ? `${weighedIn} ${hubNoun(weighedIn)} weighed in` : null,
      participation_count: weighedIn,
      comments: [],
      admin_notes: "",
    };
  },
};

export default projectAdapter;
