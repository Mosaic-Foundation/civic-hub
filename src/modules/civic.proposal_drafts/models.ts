import type { RelationType } from "../civic.process_links/models.js";

/** A related process the author picked while composing. Carried on the draft
 *  until submission, then materialized into process_links. */
export interface ProposedLink {
  to_id: string;
  relation: RelationType;
}

import type { Category } from "../civic.assistant/models.js";
import type { Suggestion } from "../civic.assistant/models.js";

export type DraftStatus = "drafting" | "submitted" | "abandoned";

/** Default proposal duration: 90 days (3 months) in milliseconds */
export const DEFAULT_PROPOSAL_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

export interface ProposalDraft {
  id: string;
  user_id: string;
  category: Category | null;
  title: string;
  description: string;
  sources: string;
  considerations: string;
  proposal_duration_ms: number;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: Suggestion[] | null;
  draft_modified_since_review: boolean;
  steward_approved: boolean | null;
  assistant_helped: boolean;
  links: ProposedLink[];
  status: DraftStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftInput {
  user_id: string;
  category?: Category;
}

export interface UpdateDraftInput {
  title?: string;
  description?: string;
  sources?: string;
  considerations?: string;
  category?: Category;
  proposal_duration_ms?: number;
  links?: ProposedLink[];
  skip_modified_flag?: boolean;
  /** The value being written is assistant-produced text (Apply on a
   *  suggestion card) — sets assistant_helped on the draft. */
  assistant_applied?: boolean;
}
