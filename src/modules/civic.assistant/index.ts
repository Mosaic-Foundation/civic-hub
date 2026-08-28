export { callAssistant, checkTextAgainstCoC, getHubConfig } from "./service.js";
export type { CallClaudeMultiTurnFn } from "./service.js";

// Shown to a creator when the automated Code-of-Conduct pre-check could not
// run (no API key, transient error, timeout). Per Decision #7 the real gate is
// human admin review, so we fail open: the submission is still allowed through
// and lands in the admin review queue. This notice keeps the failure visible
// instead of silently trapping the creator with a disabled Submit button.
export const AUTOMATED_REVIEW_UNAVAILABLE_NOTICE =
  "The automated check couldn't run just now, so we've skipped it — your submission will go straight to human review. You can submit when you're ready.";

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
