// What civic.wordcloud keeps (ADR-012, the database convention): the package
// never imports src/db/. The implementation is ./storeImpl.ts, on the
// database its host hands it (its granted tables only), bound when the hub
// loads the package (./index.ts).

import { storeSlot } from "@civic-social/plugin-sdk/first-party";

/** A stored submission, as the table has it. */
export interface SubmissionRow {
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

export interface NewSubmission {
  id: string;
  process_id: string;
  prompt_id: string;
  author_id: string | null;
  body: string;
  device_token: string | null;
}

/** A visible submission as the responses list shows it. */
export interface ResponseRow {
  id: string;
  body: string;
  submitted_at: string;
  prompt_id: string | null;
}

export interface WordcloudStore {
  /** Submissions on a process, optionally to one prompt, by one author, visible only. */
  countSubmissions(where: { processId: string; promptId?: string; authorId?: string; visibleOnly?: boolean }): Promise<number>;
  /** Store one. "duplicate": this author already answered this prompt (the unique index). */
  insertSubmission(row: NewSubmission): Promise<SubmissionRow | "duplicate">;
  /** The visible submissions' text for one prompt, all of them (paged past 1,000). */
  visibleBodies(processId: string, promptId: string): Promise<string[]>;
  /** The visible submissions, newest first, optionally for one prompt (paged past 1,000). */
  visibleResponses(processId: string, promptId?: string): Promise<ResponseRow[]>;
  /** Development seed only: every submission on the hub. */
  deleteAll(): Promise<void>;
}

export const wordcloudStore = storeSlot<WordcloudStore>("civic.wordcloud");
