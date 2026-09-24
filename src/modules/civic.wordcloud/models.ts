// civic.wordcloud — type definitions
//
// A lightweight civic process: free-text submissions aggregate into
// a live word cloud. Non-deliberative — no Civic Brief, no Board delivery.

import type { ProcessStatus } from "../../models/process.js";

export interface WordcloudPrompt {
  id: string;
  text: string;
  max_length?: number;
}

export interface WordcloudConfig {
  max_submission_length: number;
  display_threshold: number; // minimum count to appear in cloud
}

export interface WordcloudProcessState {
  type: "civic.wordcloud";
  status: ProcessStatus;
  prompts: WordcloudPrompt[];
  lifecycle_mode: "fixed" | "evergreen";
  config: WordcloudConfig;
}

export interface WordcloudSubmission {
  id: string;
  process_id: string;
  prompt_id: string;
  author_id: string | null;
  body: string;
  submitted_at: string;
  device_token: string | null;
  moderation: SubmissionModeration | null;
}

export interface SubmissionModeration {
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  reason: string | null;
  restored_at: string | null;
}

export interface CloudEntry {
  text: string;
  count: number;
}

export interface PromptCloud {
  prompt_id: string;
  prompt_text: string;
  entries: CloudEntry[];
  total_submissions: number;
}

export interface EmitEventFn {
  (input: {
    event_type: string;
    actor: string;
    process_id: string;
    jurisdiction: string;
    data: Record<string, unknown>;
    /** Phase 3 — canonical process type, stamped into data.process.type. */
    processType?: string;
    visibility?: "public" | "restricted";
    action_url_path?: string;
  }): Promise<unknown>;
}

export interface WordcloudContext {
  jurisdiction: string;
  process_id: string;
  emit: EmitEventFn;
}

export const DEFAULT_CONFIG: WordcloudConfig = {
  max_submission_length: 280,
  display_threshold: 1,
};
