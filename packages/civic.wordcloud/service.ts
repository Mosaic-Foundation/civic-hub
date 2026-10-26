// civic.wordcloud — the package's service
//
// A lightweight civic process: residents submit short free-text answers
// to prompts, and the answers aggregate live into a word cloud. Non-
// deliberative — no Civic Brief, no Board delivery. The cloud is the
// artifact.
//
// Lifecycle: draft → active → closed (subset per ADR-003).
// Evergreen mode stays in active indefinitely; admin can snapshot or close.

import { ConflictError, ValidationError, generateId } from "../../src/sdk/index.js";
import { wordcloudStore, type ResponseRow, type SubmissionRow } from "./store.js";
import { assertPassesWordlist } from "../../src/shared/wordlist/index.js";
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
    throw new ValidationError("A word cloud needs at least one prompt.", "prompt_required");
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
    throw new ConflictError(
      "This word cloud has already been activated.",
      "wrong_status",
    );
  }
  state.status = "active";

  await ctx.emit({
    event_type: "civic.process.started",
    actor,
    process_id: ctx.process_id,
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
    throw new ConflictError(
      "This word cloud is not accepting responses.",
      "not_active",
    );
  }

  const prompt = state.prompts.find((p) => p.id === payload.prompt_id);
  if (!prompt) {
    throw new ValidationError("That prompt does not exist on this word cloud.", "unknown_prompt");
  }

  const body = (payload.text ?? "").trim();
  if (!body) {
    throw new ValidationError("Submission text cannot be empty", "text_required");
  }

  const maxLen = prompt.max_length ?? state.config.max_submission_length;
  if (body.length > maxLen) {
    throw new ValidationError(`Submission exceeds maximum length of ${maxLen} characters`, "text_too_long");
  }

  // Egregious-slur pre-filter (see src/shared/wordlist). Word-cloud words are
  // rendered large and public, so this is the highest-visibility instant-post
  // surface — but the same "block only the obvious slur" bar applies.
  assertPassesWordlist(body);

  // Enforce one submission per author per prompt
  if (actor) {
    const count = await wordcloudStore.get().countSubmissions({
      processId: ctx.process_id,
      promptId: payload.prompt_id,
      authorId: actor,
    });
    if (count > 0) {
      throw new ConflictError("You have already submitted a response to this prompt", "already_submitted");
    }
  }

  const id = generateId("wcsub");

  // The count above answers a second submit with a plain refusal; two at the
  // same moment both pass it, and the unique index on (process, prompt,
  // author) lets one in (20260617000000). The other is the same refusal, not
  // a 500 (plugin conformance, 2026-10-12).
  const data = await wordcloudStore.get().insertSubmission({
    id,
    process_id: ctx.process_id,
    prompt_id: payload.prompt_id,
    author_id: actor || null,
    body,
    device_token: payload.device_token ?? null,
  });
  if (data === "duplicate") {
    throw new ConflictError("You have already submitted a response to this prompt", "already_submitted");
  }

  const submission = rowToSubmission(data);

  // Restricted event — raw text stays out of the public feed
  await ctx.emit({
    event_type: "civic.process.submission_received",
    actor,
    process_id: ctx.process_id,
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
    throw new ConflictError(
      "This word cloud is not active.",
      "not_active",
    );
  }

  const clouds = await buildClouds(ctx.process_id, state);

  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
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
    throw new ConflictError(
      "This word cloud is not active.",
      "not_active",
    );
  }

  state.status = "closed";

  const clouds = await buildClouds(ctx.process_id, state);

  await ctx.emit({
    event_type: "civic.process.ended",
    actor,
    process_id: ctx.process_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.wordcloud",
    action_url_path: `/wordcloud/${ctx.process_id}`,
    data: { process: { type: "civic.wordcloud" } },
  });

  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
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
    // All of them: a cloud can have more than 1,000 responses.
    const bodies = await wordcloudStore.get().visibleBodies(processId, prompt.id);
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
  return wordcloudStore.get().countSubmissions({ processId });
}

/** Visible submissions, newest first, optionally for one prompt. */
export async function listVisibleResponses(processId: string, promptId?: string): Promise<ResponseRow[]> {
  return wordcloudStore.get().visibleResponses(processId, promptId);
}

/** Has this person a visible submission on this word cloud? */
export async function hasVisibleSubmission(processId: string, authorId: string): Promise<boolean> {
  return (await wordcloudStore.get().countSubmissions({ processId, authorId, visibleOnly: true })) > 0;
}

// --- Dev/seed ---------------------------------------------------------------

export async function clearWordcloudSubmissions(): Promise<void> {
  await wordcloudStore.get().deleteAll();
}
