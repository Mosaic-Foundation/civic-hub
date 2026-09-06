// civic.assistant module — type definitions.
//
// The assistant is generic: it knows how to hold a drafting conversation,
// review a draft against the Code of Conduct, and generate starting drafts —
// but everything type-specific (best-practices doc, brainstorm questions,
// which form fields exist, where drafts are stored) is declared by the
// process handler through the registry (ProcessHandler.getAssistantConfig).
// No per-type assistant logic lives outside the handlers.

export type Phase = "brainstorm" | "review" | "free_form";

export type Category = "issue" | "idea" | "project" | "concern";

/** The universal output fields a drafting form can have. */
export type DraftField =
  | "title"
  | "description"
  | "sources"
  | "considerations"
  | "seed_statements"
  /** Vote drafts whose method needs a choice list (approval): one per line. */
  | "options";

export interface DraftState {
  title: string;
  description: string;
  sources: string;
  considerations: string;
  /** Conversation (deliberation) drafts only: one statement per line. */
  seed_statements?: string;
  /** Vote drafts: the choice list, one option per line (approval method). */
  options?: string;
  /** Vote drafts: the voting method, so the assistant knows which fields apply. */
  method?: string;
}

export interface Suggestion {
  severity: "soft" | "hard";
  quoted_text: string | null;
  field: DraftField | null;
  message: string;
  suggested_revision: string | null;
}

export interface DraftProposal {
  title: string;
  description: string;
  sources: string;
  considerations: string;
  /** Present only when the type declares the field (conversations). */
  seed_statements?: string;
  options?: string;
}

export interface AssistantResponse {
  message: string;
  suggestions: Suggestion[];
  draft_proposal: DraftProposal | null;
}

export interface HubConfig {
  hub_name: string;
  community_description: string;
}

export interface CallAssistantInput {
  phase: Phase;
  category?: Category;
  config: AssistantTypeConfig;
  draft_state: DraftState;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  user_message: string;
  hub_config: HubConfig;
}

/**
 * Inline guidance rendered under a form field for people drafting without
 * the assistant — sourced from the same best-practices doc the assistant
 * uses, so both paths get the same quality lift.
 */
export interface AssistantFieldGuidance {
  field: DraftField;
  /** One short line of advice. */
  hint: string;
  /** One short example, rendered after the hint. */
  example?: string;
}

/**
 * The generic view of a per-type draft row — only what the shared
 * assistant controller needs. Stores return their full row (spread into
 * this shape) so the HTTP response can hand the complete draft back to
 * the UI without the controller knowing the per-type fields.
 */
export interface AssistantDraft extends Record<string, unknown> {
  /** Vote drafts: the choice list as one-per-line text (from custom_options). */
  options?: string;
  /** Vote drafts: the voting method; decides whether `options` applies. */
  method?: string;
  id: string;
  user_id: string;
  status: string;
  category?: Category | null;
  title: string;
  description: string;
  sources: string;
  considerations?: string;
  seed_statements?: string;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Storage adapter a handler wires to its own drafts module. The shared
 * assistant route only ever touches drafts through this interface.
 *
 * Conversation appends MUST NOT mark the draft assistant-helped — the
 * flag is reserved for assistant-produced text actually landing in the
 * form: applyGeneratedDraft here, or an Apply-suggestion PATCH on the
 * per-type draft route.
 */
export interface AssistantDraftStore {
  get(id: string): Promise<AssistantDraft | undefined>;
  appendConversation(
    id: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void>;
  saveReviewResult(id: string, suggestions: Suggestion[]): Promise<void>;
  /** Write a generated starting draft into the form fields. Marks assistant_helped. */
  applyGeneratedDraft(id: string, draft: DraftProposal): Promise<void>;
}

/**
 * Everything a process type declares to opt into drafting help. A handler
 * with no config gets no assistant affordance anywhere in the UI — and no
 * assistant routes.
 */
export interface AssistantTypeConfig {
  /** What one unit is called in prose ("proposal", "vote", "project"). */
  contentNoun: string;
  /** First assistant bubble when the panel opens on an empty draft. */
  greeting: string;
  /** Hidden first user message that kicks off the brainstorm conversation. */
  kickoffMessage: string;
  /** Greeting when the panel opens and the form already has content. */
  returningGreeting: string;
  /** Full best-practices document, loaded into the system prompt. */
  bestPractices: string;
  /** Display title of that document ("Vote Best Practices"). */
  bestPracticesTitle: string;
  /** Brainstorm-phase question guidance for this type. */
  brainstormGuidance: string;
  /** Review-phase guidance about empty optional fields for this type. */
  reviewEmptyFieldsGuidance: string;
  /** Closing per-type guidance section of the system prompt. */
  typeGuidance: string;
  /** Which output fields this type's form has. */
  fields: DraftField[];
  /**
   * Optional: which of `fields` apply to THIS draft right now. A vote's
   * "options" exists only when its method needs a choice list; a yes/no vote
   * must never be offered one. Everything downstream — the prompt's draft
   * state, the reply schema's field enum, validation — uses the result, so a
   * method (or type) that declares different fields is handled by declaring
   * them, never by a branch elsewhere. Default: all of `fields`.
   */
  activeFields?: (draft: DraftState) => DraftField[];
  /** Whether the proposal-style category (issue/idea/…) applies. */
  supportsCategories: boolean;
  /** Inline per-field guidance for the form. */
  fieldGuidance: AssistantFieldGuidance[];
  /** Storage adapter for this type's draft rows. */
  draftStore: AssistantDraftStore;
}
