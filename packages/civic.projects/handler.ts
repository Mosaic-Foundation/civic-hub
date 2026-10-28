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

import {
  ValidationError,
  type Process,
  type ProcessAction,
  type ProcessHandler,
  afterActionCommits,
  readProcessState,
  writeProcessState,
  validateLinkSet,
  emitEvent,
  type BriefContent,
  createDraft,
  setDraftStatus,
  updateDraft,
  getSettingSync,
  KEYS,
  str,
  num,
  type FeedProcessMeta,
} from "@civic-social/plugin-sdk/first-party";
import { projectsStore } from "./store.js";
import {
  createProject,
  getProject,
  listProjectUpdates,
  setProjectSentiment,
  markProjectCompleted,
  getProjectReadModel,
  type SentimentValue,
} from "./service.js";
import { emitProjectCompleted, emitProjectUpdated } from "./events.js";
import { projectAssistantConfig } from "./assistantConfig.js";
import { projectDraftKind } from "./draftKind.js";
import { hubKindOf, participantNoun } from "../../src/shared/hubKind.js";
import { PROJECT_MANIFEST, SENTIMENTS } from "./manifest.js";

// What the people taking part are called on this hub (review R29, 2026-10-07).
const hubNoun = (n: number): string =>
  participantNoun(hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)), n, getSettingSync(KEYS.COPY_RESIDENT_NOUN));

const projectAdapter: ProcessHandler = {
  type: "civic.project",
  descriptor: PROJECT_MANIFEST.descriptor,
  requiredSchema: [...PROJECT_MANIFEST.requiredSchema],
  detailPath: PROJECT_MANIFEST.detailPath,
  draftPath: (draftId: string) => `/projects/new?draft=${encodeURIComponent(draftId)}`,
  reopenDraft: (draftId: string) => setDraftStatus(projectDraftKind.spec, draftId, "drafting"),

  // Creator edits (the only type that allows them — Adam, 2026-09-03):
  // while the project is active; the title locks once anyone supports it,
  // because the title is what people endorsed.
  editPolicy: async (process) => {
    const status = await projectsStore.get().statusOf(process.id);
    if (status !== "active") {
      return { editable: false, locked_fields: [], reason: "Only an active project can be edited." };
    }
    const count = await projectsStore.get().countSentiments(process.id, "support");
    return { editable: true, locked_fields: count > 0 ? ["title"] : [] };
  },
  listSupporters: async (processId) => projectsStore.get().supporterIds(processId),
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
    await projectsStore.get().resetDraftReview(draftId);
  },
  listSupportedBy: async (userId) => projectsStore.get().supportedProjectIds(userId),
  onEdited: async (process, changes) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const c = changes.current;
    if (typeof c.title === "string") patch.title = c.title;
    if (typeof c.description === "string") patch.description = c.description;
    if (Array.isArray(c.sources)) patch.sources = c.sources;
    if ("banner_image_url" in c) patch.banner_image_url = c.banner_image_url ?? null;
    if ("banner_image_alt" in c) patch.banner_image_alt = c.banner_image_alt ?? null;
    await projectsStore.get().patchProject(process.id, patch);
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
    const previous = (await projectsStore.get().statusOf(process.id)) ?? "active";

    // Re-read: archiveProcess has already written state with its archive meta.
    const state = (await readProcessState(process.id)) ?? {};
    const archive = { ...((state.archive as Record<string, unknown>) ?? {}) };
    archive.child_previous_status = previous;
    state.archive = archive;

    await writeProcessState(process.id, state);
    process.state = state;

    await projectsStore.get().setStatus(process.id, "archived");
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

    await projectsStore.get().setStatus(_process.id, next);
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
  // The feed card's fields, from the public read model.
  feedMeta(model: Record<string, unknown>): FeedProcessMeta {
    return {
      title: str(model.title),
      description: str(model.description),
      imageUrl: str(model.banner_image_url) ?? null,
      imageAlt: str(model.banner_image_alt) ?? null,
    };
  },
};

export default projectAdapter;
