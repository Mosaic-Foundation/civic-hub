import type { RelationType } from "../civic.process_links/models.js";
import type { Suggestion } from "../civic.assistant/models.js";
import type { TableName } from "../../db/forHub.js";

/** A related process the author picked while composing. Carried on the draft
 *  until submission, then materialized into process_links. */
export interface ProposedLink {
  to_id: string;
  relation: RelationType;
}

export type DraftStatus = "drafting" | "submitted" | "abandoned";

/** The fields every kind's draft has, whatever its table. */
export interface BaseDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: Suggestion[] | null;
  draft_modified_since_review: boolean;
  /** Hash of the fields the Code of Conduct check last read (services/codeOfConduct.ts). */
  coc_checked_hash: string | null;
  assistant_helped: boolean;
  links: ProposedLink[];
  status: DraftStatus;
  created_at: string;
  updated_at: string;
}

/** A kind's draft: the base fields and the kind's own (DraftSpec.fields). */
export type Draft<Extra extends object = Record<string, unknown>> = BaseDraft & Extra;

/**
 * One field a kind adds to the base draft: a column of its table. The spec
 * is all the store knows about it.
 */
export interface DraftFieldSpec {
  /** The value in a draft read from a row (a default for a null, a number from a string). */
  read?: (value: unknown) => unknown;
  /**
   * A PATCH's value, checked and normalized. Throw an Error to refuse it (the
   * message goes back as the 400). Absent: the field is not writable by PATCH.
   */
  write?: (value: unknown) => unknown;
  /** The Code of Conduct check reads it, so a change means the check must run again. */
  checked?: boolean;
}

/**
 * Everything the generic store needs to keep one kind's drafts (Audit 3, F1).
 * The tables stay as they are: one per kind, the same base columns, the
 * kind's own columns described in `fields`.
 */
export interface DraftSpec {
  /** The process type a draft of this kind becomes. */
  processType: string;
  table: TableName;
  /** generateId prefix for new drafts. */
  idPrefix: string;
  /** The kind's own columns, beyond BaseDraft. */
  fields: Record<string, DraftFieldSpec>;
  /** Column values for a new draft, beyond id and user_id (a default duration, say). */
  createDefaults?: (input: Record<string, unknown>) => Record<string, unknown>;
  /**
   * The text fields an assistant-generated first draft writes, beyond title,
   * description and sources (a proposal's considerations, a conversation's
   * seed statements).
   */
  generatedFields?: readonly string[];
}

/** The base text fields the Code of Conduct check reads, for every kind. */
export const BASE_CHECKED_FIELDS = ["title", "description", "sources"] as const;
