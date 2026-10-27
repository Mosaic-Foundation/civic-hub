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
// (AssistantTypeConfig.draftStore), so a new type gets it by declaring one; a
// type with no drafting assistant (a package on SDK v1, which gives the hub
// only its draft kind; plugin Events, 2026-10-27) is read through that kind.

import { createHash } from "node:crypto";
import { getProcessHandler } from "../processes/registry.js";
import type { AssistantDraft, DraftState } from "../modules/civic.assistant/index.js";
import type { Suggestion } from "../modules/civic.assistant/models.js";
import { getDraft, saveReviewResult } from "../modules/civic.drafts/index.js";
import { loadedPackages } from "../plugins/loader.js";

/** What the check reads a type's drafts through, and stores its result with. */
export interface CheckDraftStore {
  get(id: string): Promise<AssistantDraft | undefined>;
  saveReviewResult(id: string, suggestions: Suggestion[], checkedHash: string): Promise<void>;
}

/**
 * A type's draft store for the check: its drafting assistant's, or, for a
 * type without one, a store over the draft kind its package gave the hub.
 */
export function checkDraftStore(processType: string): CheckDraftStore | undefined {
  const assistant = getProcessHandler(processType)?.getAssistantConfig?.().draftStore;
  if (assistant) return assistant;
  const kind = loadedPackages().find((p) => p.type === processType)?.server.drafts?.kind;
  if (!kind) return undefined;
  return {
    get: async (id) => (await getDraft(kind.spec, id)) as AssistantDraft | undefined,
    saveReviewResult: (id, suggestions, checkedHash) => saveReviewResult(kind.spec, id, suggestions, checkedHash),
  };
}

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
  const store = checkDraftStore(processType);
  const draft = store ? await store.get(draftId) : undefined;
  return draft ? codeOfConductHash(codeOfConductFields(toDraftState(draft))) : null;
}

interface CheckedDraft {
  id: string;
  last_review_result: ReadonlyArray<{ severity: string; check_unavailable?: boolean }> | null;
  coc_checked_hash: string | null;
}

/**
 * Where the check stands on a draft's current text (Submit and Save, 2026-10-12:
 * Submit runs the check itself, so "not checked" is no longer a refusal):
 *   - `unchecked`: it never ran, ran on other text, or last time it could not
 *     run. Submit runs it now.
 *   - `passed`: it ran on exactly this text and found nothing hard.
 *   - `flagged`: it ran on exactly this text and found something hard.
 *     Nothing is submitted, unless the resident sends it to the admins.
 *   - `unavailable`: it could not run on this text, just now. Submitting goes
 *     ahead to an admin (fail open, Adam), never published at once.
 */
export type CodeOfConductStatus = "unchecked" | "passed" | "flagged" | "unavailable";

export interface CodeOfConductStanding {
  status: CodeOfConductStatus;
  /** The check ran on this exact text, was available, and found nothing hard. */
  passed: boolean;
}

/**
 * The standing of a draft, given the hash of its checked fields as they are
 * now. A stored "unavailable" reads as unchecked, so the next Submit tries the
 * check again rather than waving the text through on an old outage; the
 * caller that just ran it reads it with `justRan`. Pure, so the rule is
 * tested on its own.
 */
export function codeOfConductVerdict(
  draft: Omit<CheckedDraft, "id">,
  currentHash: string | null,
  opts: { justRan?: boolean } = {},
): CodeOfConductStanding {
  const result = draft.last_review_result;
  const status: CodeOfConductStatus =
    !Array.isArray(result) || !draft.coc_checked_hash || draft.coc_checked_hash !== currentHash
      ? "unchecked"
      : result.some((s) => s.check_unavailable === true)
        ? opts.justRan ? "unavailable" : "unchecked"
        : result.some((s) => s.severity === "hard")
          ? "flagged"
          : "passed";
  return { status, passed: status === "passed" };
}

/** codeOfConductVerdict for a stored draft, its current text read through its type's store. */
export async function codeOfConductStanding(
  processType: string,
  draft: CheckedDraft,
  opts: { justRan?: boolean } = {},
): Promise<CodeOfConductStanding> {
  return codeOfConductVerdict(draft, await currentCodeOfConductHash(processType, draft.id), opts);
}
