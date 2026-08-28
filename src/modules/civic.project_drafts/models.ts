import type { RelationType } from "../civic.process_links/models.js";

/** A related process the author picked while composing. Carried on the draft
 *  until submission, then materialized into process_links. */
export interface ProposedLink {
  to_id: string;
  relation: RelationType;
}

import type { Suggestion } from "../civic.assistant/models.js";

export type ProjectDraftStatus = "drafting" | "submitted" | "abandoned";

export interface ProjectDraft {
  id: string;
  user_id: string;
  title: string;
  description: string;
  sources: string;
  banner_image_url: string | null;
  banner_image_alt: string | null;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: Suggestion[] | null;
  draft_modified_since_review: boolean;
  assistant_helped: boolean;
  links: ProposedLink[];
  status: ProjectDraftStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectDraftInput {
  user_id: string;
}

export interface UpdateProjectDraftInput {
  title?: string;
  description?: string;
  sources?: string;
  banner_image_url?: string | null;
  banner_image_alt?: string | null;
  links?: ProposedLink[];
  skip_modified_flag?: boolean;
  /** The value being written is assistant-produced text (Apply on a
   *  suggestion card) — sets assistant_helped on the draft. */
  assistant_applied?: boolean;
}
