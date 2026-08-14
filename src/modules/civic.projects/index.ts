import { getDb } from "../../db/client.js";
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
  emitProjectCommented,
  emitProjectSentimentChanged,
  emitProjectArchived,
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
    throw new Error("Project title is required");
  }

  const id = input.id ?? generateId("proj");
  const sources = (input.sources ?? []).filter((s) => s.trim().length > 0);

  const { data, error } = await getDb()
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
    .select()
    .single();

  if (error) {
    throw new Error(`Projects: failed to create: ${error.message}`);
  }

  const project = rowToProject(data as ProjectRow);

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
  const { data, error } = await getDb()
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Projects: ${error.message}`);
  if (!data) return undefined;
  return rowToProject(data as ProjectRow);
}

export async function listProjects(
  statusFilter?: ProjectStatus,
): Promise<Project[]> {
  let query = getDb()
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Projects: ${error.message}`);
  return (data ?? []).map((r) => rowToProject(r as ProjectRow));
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "description" | "sources">>,
  actor: string,
  emit: EmitEventFn,
): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  if (project.user_id !== actor) {
    throw new Error("Only the project creator can edit this project");
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) updates.title = patch.title.trim();
  if (patch.description !== undefined) updates.description = patch.description.trim();
  if (patch.sources !== undefined) updates.sources = patch.sources;

  const { data, error } = await getDb()
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Projects: ${error.message}`);
  return rowToProject(data as ProjectRow);
}

export async function archiveProject(
  id: string,
  actor: string,
  emit: EmitEventFn,
): Promise<void> {
  const project = await getProject(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  if (project.user_id !== actor) {
    throw new Error("Only the project creator can archive this project");
  }

  const now = new Date().toISOString();
  const { error } = await getDb()
    .from("projects")
    .update({ status: "archived" as ProjectStatus, updated_at: now })
    .eq("id", id);
  if (error) throw new Error(`Projects: ${error.message}`);

  // Keep the canonical processes row in sync (source of truth for the unified
  // read layer). Without this, an archived project would still surface in
  // getAllProcesses, which filters on the processes-row status. No-op for any
  // legacy project that predates the unified processes row.
  const { error: procErr } = await getDb()
    .from("processes")
    .update({ status: "archived", updated_at: now })
    .eq("id", id);
  if (procErr) throw new Error(`Projects: failed to archive process row: ${procErr.message}`);

  // Archive is a terminal lifecycle transition — emit an event so the change
  // is recorded in the event log (the source of truth) rather than silent.
  await emitProjectArchived({ project_id: id, emit }, actor);
}

/**
 * Mark a project complete — its terminal, "done" transition (distinct from
 * archive, which hides it). Sets the child + canonical processes rows to
 * completed/closed in lockstep and emits a completion event. The processes
 * row goes to "closed" (still publicly visible — a finished project stays
 * on the record) so the universal brief seam / caller can spawn its brief.
 * Auth is enforced by the caller (creator or admin).
 */
export async function completeProject(
  id: string,
  actor: string,
  emit: EmitEventFn,
): Promise<void> {
  const project = await getProject(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  if (project.status !== "active") {
    throw new Error(`Only an active project can be completed (is "${project.status}").`);
  }

  const now = new Date().toISOString();
  const { error } = await getDb()
    .from("projects")
    .update({ status: "completed" as ProjectStatus, updated_at: now })
    .eq("id", id);
  if (error) throw new Error(`Projects: ${error.message}`);

  const { error: procErr } = await getDb()
    .from("processes")
    .update({ status: "closed", updated_at: now })
    .eq("id", id);
  if (procErr) throw new Error(`Projects: failed to complete process row: ${procErr.message}`);

  await emitProjectCompleted({ project_id: id, emit }, actor);
}

// --- Project Updates -------------------------------------------------------

export async function addProjectUpdate(
  projectId: string,
  actor: string,
  content: string,
  mediaUrls: string[],
  emit: EmitEventFn,
): Promise<ProjectUpdate> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.user_id !== actor) {
    throw new Error("Only the project creator can post updates");
  }
  if (!content || content.trim().length === 0) {
    throw new Error("Update content is required");
  }

  const id = generateId("pupd");

  const { data, error } = await getDb()
    .from("project_updates")
    .insert({
      id,
      project_id: projectId,
      content: content.trim(),
      media_urls: mediaUrls.filter((u) => u.trim().length > 0),
    })
    .select()
    .single();
  if (error) throw new Error(`Projects: ${error.message}`);

  await emitProjectUpdated(
    { project_id: projectId, emit },
    actor,
    { update_id: id },
  );

  return {
    id: data.id,
    project_id: data.project_id,
    content: data.content,
    media_urls: data.media_urls ?? [],
    created_at: data.created_at,
  };
}

export async function listProjectUpdates(
  projectId: string,
): Promise<ProjectUpdate[]> {
  const { data, error } = await getDb()
    .from("project_updates")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Projects: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    project_id: r.project_id,
    content: r.content,
    media_urls: r.media_urls ?? [],
    created_at: r.created_at,
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
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.status !== "active") {
    throw new Error("Cannot change sentiment on an archived project");
  }

  const db = getDb();

  if (sentiment === "neutral") {
    await db
      .from("project_sentiments")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);
  } else {
    await db
      .from("project_sentiments")
      .upsert(
        { project_id: projectId, user_id: userId, sentiment },
        { onConflict: "project_id,user_id" },
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
  const { data, error } = await getDb()
    .from("project_sentiments")
    .select("sentiment")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Projects: ${error.message}`);
  if (!data) return null;
  return data.sentiment as SentimentValue;
}

async function recountSentiments(
  projectId: string,
): Promise<{ support_count: number; oppose_count: number }> {
  const db = getDb();

  const { count: supportCount, error: sErr } = await db
    .from("project_sentiments")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("sentiment", "support");
  if (sErr) throw new Error(`Projects: ${sErr.message}`);

  const { count: opposeCount, error: oErr } = await db
    .from("project_sentiments")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("sentiment", "oppose");
  if (oErr) throw new Error(`Projects: ${oErr.message}`);

  const support_count = supportCount ?? 0;
  const oppose_count = opposeCount ?? 0;

  await db
    .from("projects")
    .update({ support_count, oppose_count, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  return { support_count, oppose_count };
}

// --- Comments --------------------------------------------------------------

export async function addProjectComment(
  projectId: string,
  userId: string,
  content: string,
  emit: EmitEventFn,
): Promise<ProjectComment> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!content || content.trim().length === 0) {
    throw new Error("Comment content is required");
  }

  const id = generateId("pcmt");

  const { data, error } = await getDb()
    .from("project_comments")
    .insert({
      id,
      project_id: projectId,
      user_id: userId,
      content: content.trim(),
    })
    .select()
    .single();
  if (error) throw new Error(`Projects: ${error.message}`);

  await emitProjectCommented(
    { project_id: projectId, emit },
    userId,
    { comment_id: id },
  );

  return {
    id: data.id,
    project_id: data.project_id,
    user_id: data.user_id,
    content: data.content,
    created_at: data.created_at,
  };
}

export async function listProjectComments(
  projectId: string,
): Promise<ProjectComment[]> {
  const { data, error } = await getDb()
    .from("project_comments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Projects: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    project_id: r.project_id,
    user_id: r.user_id,
    content: r.content,
    created_at: r.created_at,
  }));
}

// --- Read model ------------------------------------------------------------

export async function getProjectReadModel(
  id: string,
  actor?: string,
): Promise<Record<string, unknown> | undefined> {
  const project = await getProject(id);
  if (!project) return undefined;

  const updates = await listProjectUpdates(id);
  const userSentiment = actor ? await getUserSentiment(id, actor) : null;

  const { count: commentCount, error: cErr } = await getDb()
    .from("project_comments")
    .select("*", { count: "exact", head: true })
    .eq("project_id", id);
  if (cErr) throw new Error(`Projects: ${cErr.message}`);

  return {
    ...project,
    updates,
    user_sentiment: userSentiment,
    comment_count: commentCount ?? 0,
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
  const db = getDb();
  await db.from("project_comments").delete().neq("project_id", "");
  await db.from("project_sentiments").delete().neq("project_id", "");
  await db.from("project_updates").delete().neq("project_id", "");
  const { error } = await db.from("projects").delete().neq("id", "");
  if (error) throw new Error(`Projects: failed to clear: ${error.message}`);
}
