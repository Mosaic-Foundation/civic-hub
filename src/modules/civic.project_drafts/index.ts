import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import type { Suggestion } from "../civic.proposal_assistant/models.js";
import type {
  ProjectDraft,
  ProjectDraftStatus,
  CreateProjectDraftInput,
  UpdateProjectDraftInput,
} from "./models.js";

export type { ProjectDraft, ProjectDraftStatus, CreateProjectDraftInput, UpdateProjectDraftInput } from "./models.js";

interface DraftRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  conversation_history: unknown;
  last_review_result: unknown;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: unknown;
}

function rowToDraft(row: DraftRow): ProjectDraft {
  return {
    links: Array.isArray(row.links) ? (row.links as never) : [],
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    sources: row.sources,
    banner_image_url: row.banner_image_url,
    banner_image_alt: row.banner_image_alt,
    conversation_history: Array.isArray(row.conversation_history)
      ? row.conversation_history
      : [],
    last_review_result: Array.isArray(row.last_review_result)
      ? (row.last_review_result as Suggestion[])
      : null,
    draft_modified_since_review: row.draft_modified_since_review,
    assistant_helped: row.assistant_helped,
    status: row.status as ProjectDraftStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createProjectDraft(input: CreateProjectDraftInput): Promise<ProjectDraft> {
  const id = generateId("pdraft");

  const { data, error } = await getDb()
    .from("project_drafts")
    .insert({ id, user_id: input.user_id })
    .select()
    .single();

  if (error) throw new Error(`ProjectDrafts: failed to create: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function getProjectDraft(id: string): Promise<ProjectDraft | undefined> {
  const { data, error } = await getDb()
    .from("project_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
  if (!data) return undefined;
  return rowToDraft(data as DraftRow);
}

export async function listUserProjectDrafts(
  userId: string,
  statusFilter?: ProjectDraftStatus,
): Promise<ProjectDraft[]> {
  let query = getDb()
    .from("project_drafts")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
  return (data ?? []).map((r) => rowToDraft(r as DraftRow));
}

export async function updateProjectDraft(
  id: string,
  patch: UpdateProjectDraftInput,
): Promise<ProjectDraft> {
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.sources !== undefined) updates.sources = patch.sources;
  if (patch.banner_image_url !== undefined) updates.banner_image_url = patch.banner_image_url;
  if (patch.banner_image_alt !== undefined) updates.banner_image_alt = patch.banner_image_alt;

  if (patch.links !== undefined) updates.links = patch.links;

  if (!patch.skip_modified_flag) {
    updates.draft_modified_since_review = true;
  }

  const { data, error } = await getDb()
    .from("project_drafts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function appendProjectConversation(
  id: string,
  userMessage: string,
  assistantMessage: string,
  options?: { markAssisted?: boolean },
): Promise<void> {
  const draft = await getProjectDraft(id);
  if (!draft) throw new Error(`Project draft not found: ${id}`);

  const history = [
    ...draft.conversation_history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantMessage },
  ];

  // The always-on Code of Conduct pre-check is NOT writing assistance —
  // only genuine assistant exchanges may flag the draft as AI-helped.
  const updates: Record<string, unknown> = { conversation_history: history };
  if (options?.markAssisted !== false) {
    updates.assistant_helped = true;
  }

  const { error } = await getDb()
    .from("project_drafts")
    .update(updates)
    .eq("id", id);

  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
}

export async function saveProjectReviewResult(
  id: string,
  suggestions: Suggestion[],
): Promise<void> {
  const { error } = await getDb()
    .from("project_drafts")
    .update({
      last_review_result: suggestions,
      draft_modified_since_review: false,
    })
    .eq("id", id);

  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
}

export async function applyProjectDraftProposal(
  id: string,
  title: string,
  description: string,
  sources: string,
): Promise<ProjectDraft> {
  const { data, error } = await getDb()
    .from("project_drafts")
    .update({
      title,
      description,
      sources,
      assistant_helped: true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function setProjectDraftStatus(
  id: string,
  status: ProjectDraftStatus,
): Promise<void> {
  const { error } = await getDb()
    .from("project_drafts")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(`ProjectDrafts: ${error.message}`);
}
