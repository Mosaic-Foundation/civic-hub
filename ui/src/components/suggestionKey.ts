// Which suggestion is which (split from SuggestionCard.tsx).

import type { DraftSuggestion } from "../services/api";

/**
 * Identity for "has this been applied", by content rather than position.
 * Keyed on the ORIGINAL suggestion, so an in-place edit before applying does
 * not change which card is "applied", and the panel + inline CoC list (which
 * render the same suggestions) stay in sync.
 */
export function suggestionKey(s: DraftSuggestion): string {
  return [s.field ?? "", s.quoted_text ?? "", s.suggested_revision ?? ""].join("|");
}
