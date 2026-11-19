// Whether an edit changed words, not just formatting (Adam, 2026-09-03). Pure:
// the process edits service, its notifications and both digests read it.

import { stripMarkdown } from "./markdown.js";

/** Text fields where formatting-only changes are saved but not recorded. */
const TEXT_FIELDS = new Set(["title", "description"]);

/**
 * What a text edit is "about": the words, not the markup or the spacing.
 * Two texts with the same words (bold added, a line break moved) are the
 * same edit for the history and for supporters (Adam, 2026-09-03: "only
 * track changes that are more than formatting changes"). Punctuation and
 * case still count — a period or a capital is a wording choice.
 */
export function substanceOf(text: string): string {
  return stripMarkdown(text).replace(/\s+/g, " ").trim();
}

/**
 * Whether a recorded edit changed any words. Edits recorded before the
 * formatting rule (2026-09-03) can be formatting-only; every reader skips
 * those so they never show as a blank "edit" in history, the badge, the
 * digest, or the admin tab. Non-text fields always count.
 */
export function isSubstantiveEdit(edit: {
  changed_fields?: unknown;
  previous?: Record<string, unknown>;
  current?: Record<string, unknown>;
}): boolean {
  if (!Array.isArray(edit.changed_fields) || edit.changed_fields.length === 0) return false;
  return (edit.changed_fields as string[]).some((field) => {
    if (!TEXT_FIELDS.has(field)) return true;
    const before = edit.previous?.[field];
    const after = edit.current?.[field];
    return substanceOf(typeof before === "string" ? before : "") !== substanceOf(typeof after === "string" ? after : "");
  });
}
