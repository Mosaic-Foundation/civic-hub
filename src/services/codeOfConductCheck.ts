// Running the Code of Conduct check on a stored draft: one place, used by
// Submit (draftController). The older on-demand route
// (POST /assistant/:type/drafts/:id/review) was removed 2026-10-13.
//
// The check is the Code of Conduct check and nothing else (Adam,
// 2026-09-03): hard blocks only; no best-practices advice, no fact-checking,
// no web search, no chat turn. Its result is stored with the hash of exactly
// the text it read (services/codeOfConduct.ts), so a submit can tell whether
// the result covers the draft as it then stands.

import { AiLimitError, admitAiCall } from "./aiBudget.js";
import { codeOfConductFields, codeOfConductHash, toDraftState } from "./codeOfConduct.js";
import { getProcessHandler } from "../processes/registry.js";
import { checkTextAgainstCoC } from "../modules/civic.assistant/service.js";
import {
  getHubConfig,
  CHECK_UNAVAILABLE_RESULT,
  type AssistantDraft,
} from "../modules/civic.assistant/index.js";
import type { Suggestion } from "../modules/civic.assistant/models.js";

export interface CodeOfConductRun {
  /** What it found: hard blocks, or none. Empty when it was unavailable. */
  suggestions: Suggestion[];
  /** It could not run (the model down, the hub's AI budget spent). */
  unavailable: boolean;
  /** The draft as stored after the run. */
  draft: AssistantDraft;
}

/**
 * Run the check on a draft's current text and store the result. A person
 * over their own hourly count is refused (AiLimitError, 429); a hub whose
 * budget is spent, or a model that is down, makes the check "unavailable",
 * which is stored as such and fails open to human review.
 */
export async function runCodeOfConductCheck(
  processType: string,
  draft: AssistantDraft,
  userId: string,
): Promise<CodeOfConductRun> {
  const store = getProcessHandler(processType)?.getAssistantConfig?.().draftStore;
  if (!store) throw new Error(`No draft store for ${processType}`);

  // The text as the type's store reads it: the same reading the submit's
  // hash comparison uses (currentCodeOfConductHash). A caller's raw drafts row
  // lacks fields the store derives (a vote's `options` from custom_options),
  // and checking it would hash, and check, something else.
  const current = (await store.get(draft.id)) ?? draft;
  const fields = codeOfConductFields(toDraftState(current));
  const checkedHash = codeOfConductHash(fields);
  let suggestions: Suggestion[] = [];
  let unavailable = false;
  try {
    await admitAiCall("review", userId);
    suggestions = await checkTextAgainstCoC(fields, await getHubConfig());
  } catch (err) {
    if (err instanceof AiLimitError && !err.budget) throw err;
    console.error(
      `[coc-check:${processType}] unavailable, failing open to human review:`,
      err instanceof Error ? err.message : err,
    );
    unavailable = true;
  }
  await store.saveReviewResult(draft.id, unavailable ? [{ ...CHECK_UNAVAILABLE_RESULT }] : suggestions, checkedHash);
  const stored = await store.get(draft.id);
  return { suggestions, unavailable, draft: stored ?? draft };
}
