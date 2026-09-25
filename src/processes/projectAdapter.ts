// civic.project process handler — thin adapter around the civic.projects module.
//
// A Project is a resident- or org-run initiative with updates, comments, and
// support/oppose sentiment. Like proposals, projects are NOT driven through the
// generic /process/:id/action dispatcher: their lifecycle is owned by the
// civic.projects module and the /projects HTTP surface, which back the
// relational `projects` table. This adapter exists so projects live in the same
// process store and register as a known process type for the unified read layer
// (getAllProcesses / listProcessSummaries), discovery, and the dispatch loop.
//
// The module's rich read models are async (they query the `projects` table)
// while the ProcessHandler read interface is synchronous, so this adapter
// returns only the canonical fields carried on the `processes` row. Full
// project detail continues to be served by the dedicated /projects routes.

import { Process, ProcessAction } from "../models/process.js";
import { ProcessHandler } from "./types.js";
import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { validateLinkSet } from "../modules/civic.process_links/index.js";
import { getProject, listProjectUpdates } from "../modules/civic.projects/index.js";
import { emitProjectUpdated } from "../modules/civic.projects/events.js";
import { emitEvent } from "../events/eventEmitter.js";
import type { BriefContent } from "../modules/civic.brief/index.js";
import { projectAssistantConfig } from "./projectAssistantConfig.js";
import {
  createProjectDraft,
  setProjectDraftStatus,
  updateProjectDraft,
} from "../modules/civic.project_drafts/index.js";

function db() {
  return forHub(currentHubId());
}

const projectAdapter: ProcessHandler = {
  type: "civic.project",
  detailPath: (id: string) => `/project/${id}`,
  draftPath: (draftId: string) => `/projects/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => setProjectDraftStatus(draftId, "drafting"),

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
    const rows = await db()
      .from("project_sentiments")
      .select<{ user_id: string }>("user_id")
      .eq("project_id", processId)
      .eq("sentiment", "support");
    return rows.map((r) => r.user_id);
  },
  draftFromProcess: async (process, editorId, links) => {
    const project = await getProject(process.id);
    const content = (process.content ?? {}) as Record<string, unknown>;
    const draft = await createProjectDraft({ user_id: editorId });
    await updateProjectDraft(draft.id, {
      title: process.title,
      description: project?.description ?? process.description ?? "",
      sources: (project?.sources ?? (content.sources as string[] | undefined) ?? []).join("\n"),
      banner_image_url: project?.banner_image_url ?? (content.banner_image_url as string | null) ?? null,
      banner_image_alt: project?.banner_image_alt ?? (content.banner_image_alt as string | null) ?? null,
      links: validateLinkSet(process.id, links),
      skip_modified_flag: true,
    });
    return draft.id;
  },
  syncDraftFromProcess: async (draftId, process, links) => {
    const project = await getProject(process.id);
    const content = (process.content ?? {}) as Record<string, unknown>;
    await updateProjectDraft(draftId, {
      title: process.title,
      description: project?.description ?? process.description ?? "",
      sources: (project?.sources ?? (content.sources as string[] | undefined) ?? []).join("\n"),
      banner_image_url: project?.banner_image_url ?? (content.banner_image_url as string | null) ?? null,
      banner_image_alt: project?.banner_image_alt ?? (content.banner_image_alt as string | null) ?? null,
      links: validateLinkSet(process.id, links),
      skip_modified_flag: true,
    });
    // Fresh start: no stale check result, and the check must run again.
    await db()
      .from("project_drafts")
      .update({ last_review_result: null, draft_modified_since_review: true })
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

  async handleAction(
    _process: Process,
    action: ProcessAction,
  ): Promise<Record<string, unknown>> {
    throw new Error(
      `civic.project does not accept generic process actions (received "${action.type}"). ` +
        `Use the /projects endpoints for updates, comments, and sentiment.`,
    );
  },

  getReadModel(process: Process): Record<string, unknown> {
    return {
      id: process.id,
      type: process.definition.type,
      title: process.title,
      description: process.description,
      status: process.status,
      created_at: process.createdAt,
      created_by: process.createdBy,
    };
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
        weighedIn > 0 ? `${weighedIn} resident${weighedIn === 1 ? "" : "s"} weighed in` : null,
      participation_count: weighedIn,
      comments: [],
      admin_notes: "",
    };
  },
};

export default projectAdapter;
