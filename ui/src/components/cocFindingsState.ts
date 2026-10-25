import { createContext } from "react";
import type { DraftSuggestion } from "../services/api";

/**
 * What the Code of Conduct check flagged on a draft, for every field to read
 * (Submit and Save, 2026-10-12). DraftPage provides it; each form field shows
 * the findings that name it, right under the text in question. Findings on a
 * field with no spot of its own still show in the list above the form.
 */
export const CocFindingsContext = createContext<DraftSuggestion[]>([]);

/** "Seed statements", "seed statements" and "seed_statements" are one field. */
export function sameField(a: string | null | undefined, b: string): boolean {
  return (a ?? "").trim().toLowerCase().replace(/\s+/g, "_") === b;
}

/** The hard findings on a draft's stored check result. */
export function hardFindings(result: DraftSuggestion[] | null | undefined): DraftSuggestion[] {
  return (result ?? []).filter((s) => s.severity === "hard" && !s.check_unavailable);
}
