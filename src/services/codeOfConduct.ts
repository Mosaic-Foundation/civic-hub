// The Code of Conduct check's standing on a draft: did it run, on the text
// the draft holds now, and did it pass?
//
// The check reads a fixed set of fields (codeOfConductFields). When it runs,
// the hash of exactly those fields as it read them is stored with its result
// (`coc_checked_hash` on each drafts table). Every submit compares that hash
// with the draft's fields as they stand, read through the same path. So:
//   - the check cannot be skipped: no client flag says "nothing changed";
//   - a link-only edit leaves a passed check standing, because links are not
//     checked and so are not in the hash;
//   - an autosave that lands while the check is running is not covered by
//     that run's pass, because the hash is of what the check saw.
// One rule for every drafting type, read through the type's own draft store
// (AssistantTypeConfig.draftStore), so a new type gets it by declaring one.

import { createHash } from "node:crypto";
import { getProcessHandler } from "../processes/registry.js";
import type { AssistantDraft, DraftState } from "../modules/civic.assistant/index.js";

/** The generic draft fields the assistant and the check read. */
export function toDraftState(draft: AssistantDraft): DraftState {
  return {
    title: draft.title,
    description: draft.description,
    sources: draft.sources,
    considerations: draft.considerations ?? "",
    ...(draft.seed_statements !== undefined
      ? { seed_statements: draft.seed_statements }
      : {}),
    ...(draft.options !== undefined ? { options: draft.options } : {}),
    ...(draft.method !== undefined ? { method: draft.method } : {}),
  };
}

export interface CheckedField {
  label: string;
  text: string;
}

/** What the check reads: every field a resident writes that others will see. */
export function codeOfConductFields(state: DraftState): CheckedField[] {
  return [
    { label: "Title", text: state.title ?? "" },
    { label: "Description", text: state.description ?? "" },
    { label: "Sources", text: state.sources ?? "" },
    { label: "Considerations", text: state.considerations ?? "" },
    { label: "Seed statements", text: state.seed_statements ?? "" },
    { label: "Options", text: state.options ?? "" },
  ];
}

export function codeOfConductHash(fields: CheckedField[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** The hash of a stored draft's checked fields as they are now, or null. */
export async function currentCodeOfConductHash(
  processType: string,
  draftId: string,
): Promise<string | null> {
  const store = getProcessHandler(processType)?.getAssistantConfig?.().draftStore;
  const draft = store ? await store.get(draftId) : undefined;
  return draft ? codeOfConductHash(codeOfConductFields(toDraftState(draft))) : null;
}

interface CheckedDraft {
  id: string;
  last_review_result: ReadonlyArray<{ severity: string; check_unavailable?: boolean }> | null;
  coc_checked_hash: string | null;
}

export interface CodeOfConductStanding {
  /** Why the draft may not be submitted, or null when it may. */
  refusal: string | null;
  /** The check ran on this exact text, was available, and found nothing hard. */
  passed: boolean;
}

/**
 * Whether a draft may be submitted, and whether it passed, given the hash of
 * its checked fields as they are now. Submitting is allowed when the check
 * ran on the current text and found no hard block; a check that was
 * unavailable still allows it (the submission goes to an admin), but does
 * not count as passed. Pure, so the rule is tested on its own.
 */
export function codeOfConductVerdict(
  draft: Omit<CheckedDraft, "id">,
  currentHash: string | null,
): CodeOfConductStanding {
  const result = draft.last_review_result;
  if (!Array.isArray(result)) {
    return { refusal: "Run the Code of Conduct check before submitting.", passed: false };
  }
  if (result.some((s) => s.severity === "hard")) {
    return {
      refusal: "Cannot submit: unresolved Code of Conduct concerns. Review your draft.",
      passed: false,
    };
  }
  if (!draft.coc_checked_hash || draft.coc_checked_hash !== currentHash) {
    return {
      refusal: "Draft has been modified since last review. Please review again before submitting.",
      passed: false,
    };
  }
  return { refusal: null, passed: !result.some((s) => s.check_unavailable === true) };
}

/** codeOfConductVerdict for a stored draft, its current text read through its type's store. */
export async function codeOfConductStanding(
  processType: string,
  draft: CheckedDraft,
): Promise<CodeOfConductStanding> {
  return codeOfConductVerdict(draft, await currentCodeOfConductHash(processType, draft.id));
}
