import type { Suggestion } from "../civic.assistant/models.js";
import type { RelationType } from "../civic.process_links/models.js";

/** A related process the author picked while composing. Carried on the draft
 *  until submission, then materialized into process_links — the same shape
 *  proposal / vote / project drafts use. */
export interface ProposedLink {
  to_id: string;
  relation: RelationType;
}

export type DeliberationDraftStatus = "drafting" | "submitted" | "abandoned";

/** 6 weeks — the unified default duration across drafting types. */
export const DEFAULT_DELIBERATION_DURATION_MS = 42 * 24 * 60 * 60 * 1000;

/**
 * A conversation (Polis deliberation) draft. Field mapping onto the
 * generic drafting vocabulary:
 *   title       — the conversation TOPIC
 *   description — the FRAMING shown to participants
 * seed_statements (one per line) and the duration/threshold are plain
 * form fields outside the assistant's reach.
 */
export interface DeliberationDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  /** "Learn more" links under the framing, one per line. */
  sources: string;
  seed_statements: string;
  duration_ms: number;
  participation_threshold: number | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: Suggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  status: DeliberationDraftStatus;
  created_at: string;
  updated_at: string;
  links: ProposedLink[];
}

export interface CreateDeliberationDraftInput {
  user_id: string;
}

export interface UpdateDeliberationDraftInput {
  title?: string;
  description?: string;
  sources?: string;
  seed_statements?: string;
  duration_ms?: number;
  participation_threshold?: number | null;
  links?: ProposedLink[];
  skip_modified_flag?: boolean;
  /** The value being written is assistant-produced text (Apply on a
   *  suggestion card) — sets assistant_helped on the draft. */
  assistant_applied?: boolean;
}
