import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import type { Suggestion } from "../civic.assistant/models.js";
import type {
  DeliberationDraft,
  DeliberationDraftStatus,
  CreateDeliberationDraftInput,
  UpdateDeliberationDraftInput,
} from "./models.js";

export type {
  DeliberationDraft,
  DeliberationDraftStatus,
  CreateDeliberationDraftInput,
  UpdateDeliberationDraftInput,
} from "./models.js";
export { DEFAULT_DELIBERATION_DURATION_MS } from "./models.js";

// Duration picker bounds — 2 weeks to 3 months, same as votes.
const MIN_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

// --- Row mapping ---

interface DraftRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  seed_statements: string;
  duration_ms: number;
  participation_threshold: number | null;
  conversation_history: unknown;
  last_review_result: unknown;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToDraft(row: DraftRow): DeliberationDraft {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    seed_statements: row.seed_statements,
    duration_ms: Number(row.duration_ms),
    participation_threshold:
      row.participation_threshold === null || row.participation_threshold === undefined
        ? null
        : Number(row.participation_threshold),
    conversation_history: Array.isArray(row.conversation_history)
      ? row.conversation_history
      : [],
    last_review_result: Array.isArray(row.last_review_result)
      ? (row.last_review_result as Suggestion[])
      : null,
    draft_modified_since_review: row.draft_modified_since_review,
    assistant_helped: row.assistant_helped,
    status: row.status as DeliberationDraftStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- CRUD ---

export async function createDeliberationDraft(
  input: CreateDeliberationDraftInput,
): Promise<DeliberationDraft> {
  const id = generateId("ddraft");

  const { data, error } = await getDb()
    .from("deliberation_drafts")
    .insert({ id, user_id: input.user_id })
    .select()
    .single();

  if (error) throw new Error(`DeliberationDrafts: failed to create: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function getDeliberationDraft(
  id: string,
): Promise<DeliberationDraft | undefined> {
  const { data, error } = await getDb()
    .from("deliberation_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`DeliberationDrafts: ${error.message}`);
  if (!data) return undefined;
  return rowToDraft(data as DraftRow);
}

export async function updateDeliberationDraft(
  id: string,
  patch: UpdateDeliberationDraftInput,
): Promise<DeliberationDraft> {
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.seed_statements !== undefined) updates.seed_statements = patch.seed_statements;

  if (patch.duration_ms !== undefined) {
    const ms = patch.duration_ms;
    if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
      throw new Error(
        `duration_ms must be between ${MIN_DURATION_MS} (2 weeks) and ${MAX_DURATION_MS} (3 months)`,
      );
    }
    updates.duration_ms = ms;
  }

  if (patch.participation_threshold !== undefined) {
    if (patch.participation_threshold !== null) {
      const n = patch.participation_threshold;
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("participation_threshold must be a positive integer or null");
      }
    }
    updates.participation_threshold = patch.participation_threshold;
  }

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
    .from("deliberation_drafts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`DeliberationDrafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function appendDeliberationConversation(
  id: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const draft = await getDeliberationDraft(id);
  if (!draft) throw new Error(`Deliberation draft not found: ${id}`);

  const history = [
    ...draft.conversation_history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantMessage },
  ];

  // Talking to the assistant does NOT flag the draft as AI-helped — the
  // disclosure fires only when assistant-produced text lands in the form
  // (applyDeliberationDraftProposal, or updateDeliberationDraft with
  // assistant_applied).
  const { error } = await getDb()
    .from("deliberation_drafts")
    .update({ conversation_history: history })
    .eq("id", id);

  if (error) throw new Error(`DeliberationDrafts: ${error.message}`);
}

export async function saveDeliberationReviewResult(
  id: string,
  suggestions: Suggestion[],
): Promise<void> {
  const { error } = await getDb()
    .from("deliberation_drafts")
    .update({
      last_review_result: suggestions,
      draft_modified_since_review: false,
    })
    .eq("id", id);

  if (error) throw new Error(`DeliberationDrafts: ${error.message}`);
}

export async function applyDeliberationDraftProposal(
  id: string,
  title: string,
  description: string,
): Promise<DeliberationDraft> {
  const { data, error } = await getDb()
    .from("deliberation_drafts")
    .update({
      title,
      description,
      assistant_helped: true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`DeliberationDrafts: ${error.message}`);
  return rowToDraft(data as DraftRow);
}

export async function setDeliberationDraftStatus(
  id: string,
  status: DeliberationDraftStatus,
): Promise<void> {
  const { error } = await getDb()
    .from("deliberation_drafts")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(`DeliberationDrafts: ${error.message}`);
}
