// civic.wordcloud module — service interface
//
// A lightweight civic process: residents submit short free-text answers
// to prompts, and the answers aggregate live into a word cloud. Non-
// deliberative — no Civic Brief, no Board delivery. The cloud is the
// artifact.
//
// Lifecycle: draft → active → closed (subset per ADR-003).
// Evergreen mode stays in active indefinitely; admin can snapshot or close.

import { getDb } from "../../db/client.js";
import { generateId } from "../../utils/id.js";
import { assertPassesWordlist } from "../../shared/wordlist/index.js";
import { aggregateSubmissions } from "./aggregation.js";
import type {
  WordcloudProcessState,
  WordcloudConfig,
  WordcloudPrompt,
  WordcloudSubmission,
  SubmissionModeration,
  WordcloudContext,
  PromptCloud,
} from "./models.js";
import { DEFAULT_CONFIG } from "./models.js";

export type {
  WordcloudProcessState,
  WordcloudConfig,
  WordcloudPrompt,
  WordcloudSubmission,
  WordcloudContext,
  PromptCloud,
  CloudEntry,
} from "./models.js";
export { DEFAULT_CONFIG } from "./models.js";
export { aggregateSubmissions, extractWords } from "./aggregation.js";

// --- DB row mapping ---------------------------------------------------------

interface SubmissionRow {
  id: string;
  process_id: string;
  prompt_id: string;
  author_id: string | null;
  body: string;
  submitted_at: string;
  device_token: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_reason: string | null;
  restored_at: string | null;
}

function rowToSubmission(row: SubmissionRow): WordcloudSubmission {
  let moderation: SubmissionModeration | null = null;
  if (row.hidden_at) {
    const restored = row.restored_at && row.restored_at >= row.hidden_at;
    moderation = {
      hidden: !restored,
      hidden_at: row.hidden_at,
      hidden_by: row.hidden_by,
      reason: row.hidden_reason,
      restored_at: row.restored_at,
    };
  }
  return {
    id: row.id,
    process_id: row.process_id,
    prompt_id: row.prompt_id,
    author_id: row.author_id,
    body: row.body,
    submitted_at: row.submitted_at,
    device_token: row.device_token,
    moderation,
  };
}

// --- State factory ----------------------------------------------------------

export function createWordcloudState(
  input: Record<string, unknown>,
): WordcloudProcessState {
  const prompts = (input.prompts as WordcloudPrompt[] | undefined) ?? [];
  if (prompts.length === 0) {
    throw new Error("civic.wordcloud requires at least one prompt");
  }

  const lifecycleMode =
    (input.lifecycle_mode as "fixed" | "evergreen" | undefined) ?? "evergreen";

  const configInput = (input.config as Partial<WordcloudConfig>) ?? {};

  return {
    type: "civic.wordcloud",
    status: "draft",
    prompts,
    lifecycle_mode: lifecycleMode,
    config: {
      max_submission_length:
        configInput.max_submission_length ?? DEFAULT_CONFIG.max_submission_length,
      display_threshold:
        configInput.display_threshold ?? DEFAULT_CONFIG.display_threshold,
    },
  };
}

// --- Actions ----------------------------------------------------------------

export async function activateWordcloud(
  state: WordcloudProcessState,
  actor: string,
  ctx: WordcloudContext,
): Promise<{ state: WordcloudProcessState; result: Record<string, unknown> }> {
  if (state.status !== "draft") {
    throw new Error(
      `Cannot activate: process is in "${state.status}" state, not "draft"`,
    );
  }
  state.status = "active";

  await ctx.emit({
    event_type: "civic.process.started",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.wordcloud",
    action_url_path: `/wordcloud/${ctx.process_id}`,
    data: {
      process: {
        type: "civic.wordcloud",
        prompts: state.prompts.map((p) => ({ id: p.id, text: p.text })),
      },
    },
  });

  return { state, result: { status: "active" } };
}

export async function submitResponse(
  state: WordcloudProcessState,
  actor: string,
  payload: { prompt_id: string; text: string; device_token?: string },
  ctx: WordcloudContext,
): Promise<{
  state: WordcloudProcessState;
  result: Record<string, unknown>;
}> {
  if (state.status !== "active") {
    throw new Error(
      `Cannot submit: process is in "${state.status}" state, not "active"`,
    );
  }

  const prompt = state.prompts.find((p) => p.id === payload.prompt_id);
  if (!prompt) {
    throw new Error(`Unknown prompt_id: ${payload.prompt_id}`);
  }

  const body = (payload.text ?? "").trim();
  if (!body) {
    throw new Error("Submission text cannot be empty");
  }

  const maxLen = prompt.max_length ?? state.config.max_submission_length;
  if (body.length > maxLen) {
    throw new Error(`Submission exceeds maximum length of ${maxLen} characters`);
  }

  // Egregious-slur pre-filter (see src/shared/wordlist). Word-cloud words are
  // rendered large and public, so this is the highest-visibility instant-post
  // surface — but the same "block only the obvious slur" bar applies.
  assertPassesWordlist(body);

  // Enforce one submission per author per prompt
  if (actor) {
    const { count, error: countErr } = await getDb()
      .from("wordcloud_submissions")
      .select("*", { count: "exact", head: true })
      .eq("process_id", ctx.process_id)
      .eq("prompt_id", payload.prompt_id)
      .eq("author_id", actor);
    if (countErr) throw new Error(`Wordcloud: ${countErr.message}`);
    if (count && count > 0) {
      throw new Error("You have already submitted a response to this prompt");
    }
  }

  const id = generateId("wcsub");

  const { data, error } = await getDb()
    .from("wordcloud_submissions")
    .insert({
      id,
      process_id: ctx.process_id,
      prompt_id: payload.prompt_id,
      author_id: actor || null,
      body,
      device_token: payload.device_token ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Wordcloud: ${error.message}`);

  const submission = rowToSubmission(data as SubmissionRow);

  // Restricted event — raw text stays out of the public feed
  await ctx.emit({
    event_type: "civic.process.submission_received",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.wordcloud",
    visibility: "restricted",
    action_url_path: `/wordcloud/${ctx.process_id}`,
    data: {
      submission: { id: submission.id, prompt_id: payload.prompt_id },
    },
  });

  return {
    state,
    result: { submission_id: submission.id, status: "accepted" },
  };
}

export async function snapshotWordcloud(
  state: WordcloudProcessState,
  actor: string,
  ctx: WordcloudContext,
): Promise<{ state: WordcloudProcessState; result: Record<string, unknown> }> {
  if (state.status !== "active") {
    throw new Error(
      `Cannot snapshot: process is in "${state.status}" state, not "active"`,
    );
  }

  const clouds = await buildClouds(ctx.process_id, state);

  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.wordcloud",
    action_url_path: `/wordcloud/${ctx.process_id}`,
    data: {
      wordcloud_snapshot: {
        prompts: clouds.map((c) => ({
          prompt_id: c.prompt_id,
          total_submissions: c.total_submissions,
          top_entries: c.entries.slice(0, 10),
        })),
      },
    },
  });

  return { state, result: { status: "snapshot_published", clouds } };
}

export async function closeWordcloud(
  state: WordcloudProcessState,
  actor: string,
  ctx: WordcloudContext,
): Promise<{ state: WordcloudProcessState; result: Record<string, unknown> }> {
  if (state.status !== "active") {
    throw new Error(
      `Cannot close: process is in "${state.status}" state, not "active"`,
    );
  }

  state.status = "closed";

  const clouds = await buildClouds(ctx.process_id, state);

  await ctx.emit({
    event_type: "civic.process.ended",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.wordcloud",
    action_url_path: `/wordcloud/${ctx.process_id}`,
    data: { process: { type: "civic.wordcloud" } },
  });

  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.wordcloud",
    action_url_path: `/wordcloud/${ctx.process_id}`,
    data: {
      wordcloud_result: {
        prompts: clouds.map((c) => ({
          prompt_id: c.prompt_id,
          total_submissions: c.total_submissions,
          top_entries: c.entries.slice(0, 20),
        })),
      },
    },
  });

  return { state, result: { status: "closed", clouds } };
}

// --- Read model -------------------------------------------------------------

export async function buildClouds(
  processId: string,
  state: WordcloudProcessState,
): Promise<PromptCloud[]> {
  const clouds: PromptCloud[] = [];

  for (const prompt of state.prompts) {
    const { data, error } = await getDb()
      .from("wordcloud_submissions")
      .select("body")
      .eq("process_id", processId)
      .eq("prompt_id", prompt.id)
      .is("hidden_at", null);

    if (error) throw new Error(`Wordcloud: ${error.message}`);

    const bodies = (data ?? []).map((r: { body: string }) => r.body);
    const entries = aggregateSubmissions(bodies, state.config);

    clouds.push({
      prompt_id: prompt.id,
      prompt_text: prompt.text,
      entries,
      total_submissions: bodies.length,
    });
  }

  return clouds;
}

export async function getSubmissionCount(processId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("wordcloud_submissions")
    .select("*", { count: "exact", head: true })
    .eq("process_id", processId);
  if (error) throw new Error(`Wordcloud: ${error.message}`);
  return count ?? 0;
}

// --- Dev/seed ---------------------------------------------------------------

export async function clearWordcloudSubmissions(): Promise<void> {
  const { error } = await getDb()
    .from("wordcloud_submissions")
    .delete()
    .neq("id", "");
  if (error)
    throw new Error(`Wordcloud: failed to clear submissions: ${error.message}`);
}
