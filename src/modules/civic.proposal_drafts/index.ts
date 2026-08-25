import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import type { Suggestion } from "../civic.proposal_assistant/models.js";
import type {
  ProposalDraft,
  DraftStatus,
  CreateDraftInput,
  UpdateDraftInput,
} from "./models.js";

export type { ProposalDraft, DraftStatus, CreateDraftInput, UpdateDraftInput } from "./models.js";

// --- Row mapping ---

interface DraftRow {
  id: string;
  user_id: string;
  category: string | null;
  title: string;
  description: string;
  sources: string;
  considerations: string;
  proposal_duration_ms: number;
  conversation_history: unknown;
  last_review_result: unknown;
  draft_modified_since_review: boolean;
  steward_approved: boolean | null;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: unknown;
}

function rowToDraft(row: DraftRow): ProposalDraft {
  return {
    links: Array.isArray(row.links) ? (row.links as never) : [],
    id: row.id,
    user_id: row.user_id,
    category: row.category as ProposalDraft["category"],
    title: row.title,
    description: row.description,
    sources: row.sources,
    considerations: row.considerations,
    proposal_duration_ms: row.proposal_duration_ms,
    conversation_history: Array.isArray(row.conversation_history)
      ? row.conversation_history
      : [],
    last_review_result: Array.isArray(row.last_review_result)
      ? (row.last_review_result as Suggestion[])
      : null,
    draft_modified_since_review: row.draft_modified_since_review,
    steward_approved: row.steward_approved,
    assistant_helped: row.assistant_helped,
    status: row.status as DraftStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- CRUD ---

export async function createDraft(input: CreateDraftInput): Promise<ProposalDraft> {
  const id = generateId("pdraft");

  const { data, error } = await getDb()
    .from("proposal_drafts")
    .insert({
      id,
      user_id: input.user_id,
      category: input.category ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Drafts: failed to create: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function getDraft(id: string): Promise<ProposalDraft | undefined> {
  const { data, error } = await getDb()
    .from("proposal_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Drafts: ${error.message}`);
  if (!data) return undefined;
  return rowToDraft(data as DraftRow);
}

export async function listUserDrafts(
  userId: string,
  statusFilter?: DraftStatus,
): Promise<ProposalDraft[]> {
  let query = getDb()
    .from("proposal_drafts")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Drafts: ${error.message}`);
  return (data ?? []).map((r) => rowToDraft(r as DraftRow));
}

export async function updateDraft(
  id: string,
  patch: UpdateDraftInput,
): Promise<ProposalDraft> {
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.sources !== undefined) updates.sources = patch.sources;
  if (patch.considerations !== undefined) updates.considerations = patch.considerations;
  if (patch.category !== undefined) updates.category = patch.category;
  if (patch.proposal_duration_ms !== undefined) updates.proposal_duration_ms = patch.proposal_duration_ms;

  if (patch.links !== undefined) updates.links = patch.links;

  if (!patch.skip_modified_flag) {
    updates.draft_modified_since_review = true;
  }

  const { data, error } = await getDb()
    .from("proposal_drafts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`Drafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function appendConversation(
  id: string,
  userMessage: string,
  assistantMessage: string,
  options?: { markAssisted?: boolean },
): Promise<void> {
  const draft = await getDraft(id);
  if (!draft) throw new Error(`Draft not found: ${id}`);

  const history = [
    ...draft.conversation_history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantMessage },
  ];

  // The always-on Code of Conduct pre-check is NOT writing assistance —
  // only genuine assistant exchanges may flag the draft as AI-helped
  // (which drives the public "drafted with assistant help" disclosure).
  const updates: Record<string, unknown> = { conversation_history: history };
  if (options?.markAssisted !== false) {
    updates.assistant_helped = true;
  }

  const { error } = await getDb()
    .from("proposal_drafts")
    .update(updates)
    .eq("id", id);

  if (error) throw new Error(`Drafts: ${error.message}`);
}

export async function saveReviewResult(
  id: string,
  suggestions: Suggestion[],
): Promise<void> {
  const { error } = await getDb()
    .from("proposal_drafts")
    .update({
      last_review_result: suggestions,
      draft_modified_since_review: false,
    })
    .eq("id", id);

  if (error) throw new Error(`Drafts: ${error.message}`);
}

export async function applyDraftProposal(
  id: string,
  title: string,
  description: string,
  sources: string,
  considerations: string,
): Promise<ProposalDraft> {
  const { data, error } = await getDb()
    .from("proposal_drafts")
    .update({
      title,
      description,
      sources,
      considerations,
      assistant_helped: true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`Drafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function setDraftStatus(
  id: string,
  status: DraftStatus,
): Promise<void> {
  const { error } = await getDb()
    .from("proposal_drafts")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(`Drafts: ${error.message}`);
}

/**
 * Atomically claim a draft for submission: flip drafting → submitted only
 * if it is still "drafting". Returns true if this call won the claim, false
 * if it was already claimed (concurrent/duplicate submit). The conditional
 * WHERE makes this the single source of truth against double submission.
 */
export async function claimDraftForSubmission(id: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("proposal_drafts")
    .update({ status: "submitted" as DraftStatus })
    .eq("id", id)
    .eq("status", "drafting")
    .select("id");

  if (error) throw new Error(`Drafts: ${error.message}`);
  return !!data && data.length > 0;
}
