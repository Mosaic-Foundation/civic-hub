// The Code of Conduct check as a fixed rule, for tests (CIVIC_COC_FAKE=on,
// never in production; src/config/devFlags.ts). Stands in for the AI call
// only: the hash, the stored result, the submit gate and "tell the admins"
// are the real ones, so the suites prove the real path.
//
//   a field containing [coc-flag]  → one hard finding on that field, quoting it
//   any field containing [coc-down] → the check is unavailable (it throws)
//   anything else                  → passes

import type { DraftField, Suggestion } from "../modules/civic.assistant/models.js";
import type { CheckedField } from "../services/codeOfConduct.js";

export const FAKE_COC_FLAG = "[coc-flag]";
export const FAKE_COC_DOWN = "[coc-down]";

/** "Seed statements" → "seed_statements": the field the form shows the finding under. */
function fieldOf(label: string): DraftField {
  return label.toLowerCase().replace(/\s+/g, "_") as DraftField;
}

export function fakeCodeOfConductCheck(fields: CheckedField[]): Suggestion[] {
  if (fields.some((f) => f.text.includes(FAKE_COC_DOWN))) {
    throw new Error("fake Code of Conduct check: down");
  }
  return fields
    .filter((f) => f.text.includes(FAKE_COC_FLAG))
    .map((f) => ({
      severity: "hard" as const,
      field: fieldOf(f.label),
      quoted_text: FAKE_COC_FLAG,
      message: "This breaks the Code of Conduct (test rule).",
      suggested_revision: null,
    }));
}
