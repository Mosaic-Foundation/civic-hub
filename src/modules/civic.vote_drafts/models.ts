import type { RelationType } from "../civic.process_links/models.js";

/** A related process the author picked while composing. Carried on the draft
 *  until submission, then materialized into process_links. */
export interface ProposedLink {
  to_id: string;
  relation: RelationType;
}

import type { Suggestion } from "../civic.assistant/models.js";

export type VoteDraftStatus = "drafting" | "submitted" | "abandoned";

export interface VoteDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  voting_duration_ms: number;
  method: string; // "yes_no_unsure" | "approval"
  custom_options: string[] | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: Suggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  links: ProposedLink[];
  status: VoteDraftStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateVoteDraftInput {
  user_id: string;
}

export interface UpdateVoteDraftInput {
  title?: string;
  description?: string;
  sources?: string;
  voting_duration_ms?: number;
  method?: string;
  custom_options?: string[] | null;
  links?: ProposedLink[];
  skip_modified_flag?: boolean;
  /** The value being written is assistant-produced text (Apply on a
   *  suggestion card) — sets assistant_helped on the draft. */
  assistant_applied?: boolean;
}
