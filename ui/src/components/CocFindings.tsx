import { createContext, useContext } from "react";
import type { DraftSuggestion } from "../services/api";
import "./CocFindings.css";

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

/** The check's findings on one field, under that field. */
export function FieldFinding({ field }: { field: string }) {
  const findings = useContext(CocFindingsContext).filter((f) => sameField(f.field, field));
  if (findings.length === 0) return null;
  return (
    <div className="field-finding" role="alert">
      {findings.map((f, i) => (
        <p key={i} className="field-finding-text">
          <strong>Code of Conduct:</strong> {f.message}
          {f.quoted_text && (
            <>
              {" "}
              <span className="field-finding-quote">“{f.quoted_text}”</span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
