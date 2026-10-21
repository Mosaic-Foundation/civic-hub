// civic.assistant module — type definitions.
//
// The assistant is generic: it knows how to hold a drafting conversation,
// review a draft against the Code of Conduct, and generate starting drafts —
// but everything type-specific (best-practices doc, brainstorm questions,
// which form fields exist, where drafts are stored) is declared by the
// process handler through the registry (ProcessHandler.getAssistantConfig).
// No per-type assistant logic lives outside the handlers.

import type {
  Category, DraftField, DraftState, Suggestion, DraftProposal,
  AssistantFieldGuidance, AssistantDraft, AssistantDraftStore, AssistantTypeConfig,
} from "../../processes/contracts/draftingHelp.js";

export type {
  Category, DraftField, DraftState, Suggestion, DraftProposal,
  AssistantFieldGuidance, AssistantDraft, AssistantDraftStore, AssistantTypeConfig,
} from "../../processes/contracts/draftingHelp.js";

export type Phase = "brainstorm" | "review" | "free_form";

export interface AssistantResponse {
  message: string;
  suggestions: Suggestion[];
  draft_proposal: DraftProposal | null;
}

export interface HubConfig {
  hub_name: string;
  community_description: string;
  /**
   * The hub's own Code of Conduct, exactly as its residents read it on the
   * Code of Conduct page. The assistant used to carry an embedded copy of
   * Floyd's, which had drifted a version behind the published one — so the
   * automated check enforced a code nobody could read, on every hub.
   */
  code_of_conduct: string;
}

export interface CallAssistantInput {
  phase: Phase;
  category?: Category;
  config: AssistantTypeConfig;
  draft_state: DraftState;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  user_message: string;
  hub_config: HubConfig;
  /** What the call is for, for the hub's usage record (Audit 2). */
  purpose?: "assistant.message" | "assistant.suggest";
  /** The hub's AI limits that shape the call: how much history, and search. */
  limits?: { history_messages: number; web_search: boolean };
}
