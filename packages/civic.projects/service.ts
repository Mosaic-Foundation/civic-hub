import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  generateId,
  listVisibleInPhase,
  countVisibleOutsidePhase,
} from "@civic-social/plugin-sdk/first-party";
import { projectsStore, type ProjectRow } from "./store.js";
import type {
  Project,
  ProjectUpdate,
  ProjectComment,
  ProjectStatus,
  SentimentValue,
  CreateProjectInput,
} from "./models.js";
import {
  emitProjectCreated,
  emitProjectUpdated,
  emitProjectSentimentChanged,
  emitProjectCompleted,
  type EmitEventFn,
} from "./events.js";

export type {
  Project,
  ProjectUpdate,
  ProjectComment,
  ProjectStatus,
  SentimentValue,
  CreateProjectInput,
} from "./models.js";

// --- Row <-> model mapping -------------------------------------------------

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description ?? "",
    sources: row.sources ?? [],
    status: row.status,
    support_count: row.support_count,
    oppose_count: row.oppose_count,
    assistant_helped: row.assistant_helped,
    banner_image_url: row.banner_image_url,
    banner_image_alt: row.banner_image_alt,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- Project CRUD ----------------------------------------------------------

export async function createProject(
  input: CreateProjectInput,
  emit: EmitEventFn,
): Promise<Project> {
  if (!input.title || input.title.trim().length === 0) {
    throw new ValidationError("Project title is required", "title_required");
  }

  const id = input.id ?? generateId("proj");
  const sources = (input.sources ?? []).filter((s) => s.trim().length > 0);

  const data = await projectsStore.get().insertProject({
    id,
    user_id: input.user_id,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    sources,
    status: "active" as ProjectStatus,
    support_count: 0,
    oppose_count: 0,
    assistant_helped: input.assistant_helped ?? false,
    banner_image_url: input.banner_image_url ?? null,
    banner_image_alt: input.banner_image_alt ?? null,
  });

  const project = rowToProject(data);

  console.log(
    `[project] created "${project.title}" (${id}) by ${project.user_id}`,
  );

  await emitProjectCreated(
    { project_id: id, emit },
    input.user_id,
    { title: project.title },
  );

  return project;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const data = await projectsStore.get().findProject(id);
  if (!data) return undefined;
  return rowToProject(data);
}

export async function listProjects(
  statusFilter?: ProjectStatus,
): Promise<Project[]> {
  const data = await projectsStore.get().listProjects(statusFilter);
  return data.map(rowToProject);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "description" | "sources">>,
  actor: string,
  emit: EmitEventFn,
): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new NotFoundError("Project not found", "project_not_found");
  if (project.user_id !== actor) {
    throw new ForbiddenError("Only the project creator can edit this project", "creator_only");
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) updates.title = patch.title.trim();
  if (patch.description !== undefined) updates.description = patch.description.trim();
  if (patch.sources !== undefined) updates.sources = patch.sources;

  const data = await projectsStore.get().updateProject(id, updates);
  return rowToProject(data);
}

/**
 * Copy a committed completion onto the projects row (only an active one). A
 * project's status changes through executeAction (src/processes/
 * projectAdapter.ts, process.complete): the processes row, with its events,
 * in one transaction; this copy is written after it commits.
 */
export async function markProjectCompleted(id: string): Promise<void> {
  await projectsStore.get().completeIfActive(id);
}

// --- Project Updates -------------------------------------------------------

/**
 * A project's updates — creator posts stored by civic.input with phase
 * "update" (2026-09-06: projects kept their own tables and so had no word
 * list, no admin hide, no audit trail; now one module serves every type).
 * Hidden updates are left out, as they are everywhere else.
 */
export async function listProjectUpdates(
  projectId: string,
): Promise<ProjectUpdate[]> {
  const data = await listVisibleInPhase(projectId, "update");
  return data.map((r) => ({
    id: r.id,
    project_id: r.process_id,
    content: r.body,
    media_urls: [],
    created_at: r.submitted_at,
  }));
}

// --- Sentiment -------------------------------------------------------------

export async function setProjectSentiment(
  projectId: string,
  userId: string,
  sentiment: SentimentValue | "neutral",
  emit: EmitEventFn,
): Promise<{ support_count: number; oppose_count: number; user_sentiment: SentimentValue | null }> {
  const project = await getProject(projectId);
  if (!project) throw new NotFoundError("Project not found", "project_not_found");
  if (project.status !== "active") {
    throw new ConflictError("Cannot change sentiment on an archived project", "project_not_active");
  }

  if (sentiment === "neutral") {
    await projectsStore.get().deleteSentiment(projectId, userId);
  } else {
    await projectsStore.get().upsertSentiment(projectId, userId, sentiment);
  }

  const counts = await recountSentiments(projectId);

  await emitProjectSentimentChanged(
    { project_id: projectId, emit },
    userId,
    { sentiment, ...counts },
  );

  return {
    ...counts,
    user_sentiment: sentiment === "neutral" ? null : sentiment,
  };
}

export async function getUserSentiment(
  projectId: string,
  userId: string,
): Promise<SentimentValue | null> {
  return projectsStore.get().sentimentOf(projectId, userId);
}

async function recountSentiments(
  projectId: string,
): Promise<{ support_count: number; oppose_count: number }> {
  const support_count = await projectsStore.get().countSentiments(projectId, "support");
  const oppose_count = await projectsStore.get().countSentiments(projectId, "oppose");

  await projectsStore.get().setSentimentCounts(projectId, { support_count, oppose_count });

  return { support_count, oppose_count };
}

// --- Comments --------------------------------------------------------------
// Posted and read through civic.input (POST/GET /process/:id/input), the
// same module every other type uses. Nothing project-specific remains.

// --- Read model ------------------------------------------------------------

export async function getProjectReadModel(
  id: string,
  actor?: string,
): Promise<Record<string, unknown> | undefined> {
  const project = await getProject(id);
  if (!project) return undefined;

  const updates = await listProjectUpdates(id);
  const userSentiment = actor ? await getUserSentiment(id, actor) : null;

  const commentCount = await countVisibleOutsidePhase(id, "update");

  return {
    ...project,
    updates,
    user_sentiment: userSentiment,
    comment_count: commentCount,
  };
}

export function getProjectSummary(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    user_id: project.user_id,
    status: project.status,
    support_count: project.support_count,
    oppose_count: project.oppose_count,
    assistant_helped: project.assistant_helped,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

// --- Dev/test utilities ----------------------------------------------------

export async function clearProjects(): Promise<void> {
  await projectsStore.get().deleteAll();
}
