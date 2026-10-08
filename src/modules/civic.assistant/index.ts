export { callAssistant, checkTextAgainstCoC, getHubConfig } from "./service.js";
export type { CallClaudeMultiTurnFn } from "./service.js";

// Shown to a creator when the automated Code-of-Conduct pre-check could not
// run (no API key, transient error, timeout). Per Decision #7 the real gate is
// human admin review, so we fail open: the submission is still allowed through
// and lands in the admin review queue. This notice keeps the failure visible
// instead of silently trapping the creator with a disabled Submit button.
export const AUTOMATED_REVIEW_UNAVAILABLE_NOTICE =
  "The automated check couldn't run just now, so we've skipped it — your submission will go straight to human review. You can submit when you're ready.";

/**
 * What a draft stores when the check could not run: a soft entry (never shown
 * on the form, never blocking) that says so, so the result is not mistaken
 * for a pass (draftPassedCodeOfConduct in civic.review).
 */
export const CHECK_UNAVAILABLE_RESULT = {
  severity: "soft",
  quoted_text: null,
  field: null,
  message: "The automated Code of Conduct check could not run.",
  suggested_revision: null,
  check_unavailable: true,
} as const;

export type {
  Phase,
  Category,
  DraftField,
  Suggestion,
  DraftState,
  DraftProposal,
  AssistantResponse,
  HubConfig,
  CallAssistantInput,
  AssistantTypeConfig,
  AssistantDraft,
  AssistantDraftStore,
  AssistantFieldGuidance,
} from "./models.js";
