import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import type { Suggestion } from "../civic.assistant/models.js";
import type {
  VoteDraft,
  VoteDraftStatus,
  CreateVoteDraftInput,
  UpdateVoteDraftInput,
} from "./models.js";

export type { VoteDraft, VoteDraftStatus, CreateVoteDraftInput, UpdateVoteDraftInput } from "./models.js";

const MIN_DURATION_MS = 14 * 24 * 60 * 60 * 1000;   // 2 weeks
const MAX_DURATION_MS = 90 * 24 * 60 * 60 * 1000;    // 3 months

interface DraftRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  voting_duration_ms: number;
  method: string;
  custom_options: unknown;
  conversation_history: unknown;
  last_review_result: unknown;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  links: unknown;
}

function rowToDraft(row: DraftRow): VoteDraft {
  return {
    links: Array.isArray(row.links) ? (row.links as never) : [],
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    sources: row.sources,
    voting_duration_ms: Number(row.voting_duration_ms),
    method: row.method ?? "yes_no_unsure",
    custom_options: Array.isArray(row.custom_options) ? row.custom_options as string[] : null,
    conversation_history: Array.isArray(row.conversation_history)
      ? row.conversation_history
      : [],
    last_review_result: Array.isArray(row.last_review_result)
      ? (row.last_review_result as Suggestion[])
      : null,
    draft_modified_since_review: row.draft_modified_since_review,
    assistant_helped: row.assistant_helped,
    status: row.status as VoteDraftStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createVoteDraft(input: CreateVoteDraftInput): Promise<VoteDraft> {
  const id = generateId("vdraft");

  const { data, error } = await getDb()
    .from("vote_drafts")
    .insert({ id, user_id: input.user_id })
    .select()
    .single();

  if (error) throw new Error(`VoteDrafts: failed to create: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function getVoteDraft(id: string): Promise<VoteDraft | undefined> {
  const { data, error } = await getDb()
    .from("vote_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`VoteDrafts: ${error.message}`);
  if (!data) return undefined;
  return rowToDraft(data as DraftRow);
}

export async function listUserVoteDrafts(
  userId: string,
  statusFilter?: VoteDraftStatus,
): Promise<VoteDraft[]> {
  let query = getDb()
    .from("vote_drafts")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`VoteDrafts: ${error.message}`);
  return (data ?? []).map((r) => rowToDraft(r as DraftRow));
}

export async function updateVoteDraft(
  id: string,
  patch: UpdateVoteDraftInput,
): Promise<VoteDraft> {
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.sources !== undefined) updates.sources = patch.sources;

  if (patch.voting_duration_ms !== undefined) {
    const ms = patch.voting_duration_ms;
    if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
      throw new Error(
        `voting_duration_ms must be between ${MIN_DURATION_MS} (2 weeks) and ${MAX_DURATION_MS} (3 months)`,
      );
    }
    updates.voting_duration_ms = ms;
  }

  if (patch.method !== undefined) {
    const valid = ["yes_no_unsure", "approval"];
    if (!valid.includes(patch.method)) {
      throw new Error(`method must be one of: ${valid.join(", ")}`);
    }
    updates.method = patch.method;
  }

  if (patch.custom_options !== undefined) {
    if (patch.custom_options !== null) {
      if (!Array.isArray(patch.custom_options) || patch.custom_options.length < 2) {
        throw new Error("custom_options must be an array with at least 2 items");
      }
    }
    updates.custom_options = patch.custom_options;
  }

  if (patch.links !== undefined) updates.links = patch.links;

  // assistant_applied: the caller is writing assistant-produced text into
  // the form (Apply on a suggestion card). This — not conversation — is
  // what flips the public "drafted with assistant help" disclosure.
  if (patch.assistant_applied) {
    updates.assistant_helped = true;
  }

  if (!patch.skip_modified_flag) {
    updates.draft_modified_since_review = true;
  }

  const { data, error } = await getDb()
    .from("vote_drafts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`VoteDrafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function appendVoteConversation(
  id: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const draft = await getVoteDraft(id);
  if (!draft) throw new Error(`Vote draft not found: ${id}`);

  const history = [
    ...draft.conversation_history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantMessage },
  ];

  // Talking to the assistant does NOT flag the draft as AI-helped — the
  // disclosure fires only when assistant-produced text lands in the form
  // (applyVoteDraftProposal, or updateVoteDraft with assistant_applied).
  const { error } = await getDb()
    .from("vote_drafts")
    .update({ conversation_history: history })
    .eq("id", id);

  if (error) throw new Error(`VoteDrafts: ${error.message}`);
}

export async function saveVoteReviewResult(
  id: string,
  suggestions: Suggestion[],
): Promise<void> {
  const { error } = await getDb()
    .from("vote_drafts")
    .update({
      last_review_result: suggestions,
      draft_modified_since_review: false,
    })
    .eq("id", id);

  if (error) throw new Error(`VoteDrafts: ${error.message}`);
}

export async function applyVoteDraftProposal(
  id: string,
  title: string,
  description: string,
  sources: string,
): Promise<VoteDraft> {
  const { data, error } = await getDb()
    .from("vote_drafts")
    .update({
      title,
      description,
      sources,
      assistant_helped: true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`VoteDrafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function setVoteDraftStatus(
  id: string,
  status: VoteDraftStatus,
): Promise<void> {
  const { error } = await getDb()
    .from("vote_drafts")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(`VoteDrafts: ${error.message}`);
}
