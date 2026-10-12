import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors/index.js";
import { forHub, type HubDb } from "../../db/forHub.js";
import { currentHubId } from "../../config/hubContext.js";
import { generateId } from "../../utils/id.js";
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
import { readAll } from "../../db/readAll.js";

function db(): HubDb {
  return forHub(currentHubId());
}

// --- Row <-> model mapping -------------------------------------------------

interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  sources: string[] | null;
  status: ProjectStatus;
  support_count: number;
  oppose_count: number;
  assistant_helped: boolean;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  created_at: string;
  updated_at: string;
}

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

  const data = await db()
    .from("projects")
    .insert({
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
    })
    .select<ProjectRow>()
    .single();

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
  const data = await db()
    .from("projects")
    .select<ProjectRow>("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return undefined;
  return rowToProject(data);
}

export async function listProjects(
  statusFilter?: ProjectStatus,
): Promise<Project[]> {
  // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
  const data = await readAll((from, to) => {
    let query = db()
      .from("projects")
      .select<ProjectRow>("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    } else {
      // Default-exclude archived, for the same reason as proposals: an
      // unfiltered list is the public list.
      query = query.neq("status", "archived");
    }

    return query.range(from, to);
  });
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

  const data = await db()
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select<ProjectRow>()
    .single();
  return rowToProject(data);
}

/**
 * Copy a committed completion onto the projects row (only an active one). A
 * project's status changes through executeAction (src/processes/
 * projectAdapter.ts, process.complete): the processes row, with its events,
 * in one transaction; this copy is written after it commits.
 */
export async function markProjectCompleted(id: string): Promise<void> {
  await db()
    .from("projects")
    .update({ status: "completed" as ProjectStatus, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "active");
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
  const data = await db()
    .from("community_inputs")
    .select<{ id: string; process_id: string; body: string; submitted_at: string }>(
      "id, process_id, body, submitted_at",
    )
    .eq("process_id", projectId)
    .eq("phase", "update")
    .is("hidden_at", null)
    .order("submitted_at", { ascending: false });
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

  const hubDb = db();

  if (sentiment === "neutral") {
    await hubDb
      .from("project_sentiments")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);
  } else {
    await hubDb
      .from("project_sentiments")
      .upsert(
        { project_id: projectId, user_id: userId, sentiment },
        { onConflict: "hub_id,project_id,user_id" },
      );
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
  const data = await db()
    .from("project_sentiments")
    .select<{ sentiment: SentimentValue }>("sentiment")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return data.sentiment;
}

async function recountSentiments(
  projectId: string,
): Promise<{ support_count: number; oppose_count: number }> {
  const hubDb = db();

  const support_count = await hubDb
    .from("project_sentiments")
    .count()
    .eq("project_id", projectId)
    .eq("sentiment", "support");

  const oppose_count = await hubDb
    .from("project_sentiments")
    .count()
    .eq("project_id", projectId)
    .eq("sentiment", "oppose");

  await hubDb
    .from("projects")
    .update({ support_count, oppose_count, updated_at: new Date().toISOString() })
    .eq("id", projectId);

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

  const commentCount = await db()
    .from("community_inputs")
    .count()
    .eq("process_id", id)
    .neq("phase", "update")
    .is("hidden_at", null);

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
  const hubDb = db();
  await hubDb.from("project_sentiments").delete().neq("project_id", "");
  await hubDb.from("projects").delete().neq("id", "");
}
