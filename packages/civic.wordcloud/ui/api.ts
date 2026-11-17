// Word clouds' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): its own routes under /wordcloud, and the
// kernel's process routes (/process, /process/:id/action) for the rest.

import { apiRequest, askAboutYouFirst } from "@civic-social/plugin-sdk/ui";

export interface WordcloudCloudEntry {
  text: string;
  count: number;
}

export interface WordcloudPromptCloud {
  prompt_id: string;
  prompt_text: string;
  entries: WordcloudCloudEntry[];
  total_submissions: number;
}

export interface WordcloudState {
  id: string;
  type: "civic.wordcloud";
  title: string;
  description: string;
  status: string;
  prompts: Array<{ id: string; text: string; max_length?: number }>;
  lifecycle_mode: "fixed" | "evergreen";
  config: {
    max_submission_length: number;
    display_threshold: number;
  };
  submission_count: number;
  clouds: WordcloudPromptCloud[];
  jurisdiction: string;
  created_at: string;
  created_by: string;
  has_submitted: boolean;
  /** Seeded sample content (Phase 7): present and true for planted rows. */
  is_sample?: boolean;
}

/**
 * The actor is resolved from the session token the request wrapper already
 * sends — never from a query param, which let any caller read another
 * resident's per-actor fields by passing their user id.
 */
export function getWordcloud(id: string): Promise<WordcloudState> {
  return apiRequest("GET", `/wordcloud/${id}`);
}

export function getWordcloudCloud(
  id: string,
): Promise<{
  id: string;
  status: string;
  submission_count: number;
  clouds: WordcloudPromptCloud[];
}> {
  return apiRequest("GET", `/wordcloud/${id}/cloud`);
}

export interface WordcloudResponse {
  id: string;
  body: string;
  submitted_at: string;
  prompt_id: string;
}

export function getWordcloudResponses(
  id: string,
  promptId?: string,
): Promise<{ responses: WordcloudResponse[] }> {
  const qs = promptId ? `?prompt_id=${promptId}` : "";
  return apiRequest("GET", `/wordcloud/${id}/responses${qs}`);
}

export async function createWordcloudProcess(input: {
  title: string;
  description: string;
  promptText: string;
}): Promise<{ id: string }> {
  const promptId = `prompt-${Date.now()}`;
  const process = await apiRequest<{ id: string }>("POST", "/process", {
    definition: { type: "civic.wordcloud" },
    title: input.title,
    description: input.description,
    state: {
      prompts: [{ id: promptId, text: input.promptText }],
      lifecycle_mode: "evergreen",
    },
  });
  await apiRequest("POST", `/process/${process.id}/action`, {
    type: "process.activate",
    payload: {},
  });
  return process;
}

export async function submitWordcloudResponse(
  processId: string,
  promptId: string,
  text: string,
): Promise<unknown> {
  // Responding is taking part: the one-time About-you card first.
  await askAboutYouFirst();
  return apiRequest("POST", `/process/${processId}/action`, {
    type: "process.submit",
    actor: "unused",
    payload: { prompt_id: promptId, text },
  });
}
