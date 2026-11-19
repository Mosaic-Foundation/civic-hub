// codeOfConduct: the hub's automated Code of Conduct check, as a package runs
// it on text a person submits outside a draft (kernel step 1, Conversations
// 0.3.0; docs/kernel/SURFACE.md, "Review"). The check is the hub's own
// moderation, counted against the person and the hub's budget, never the
// package's grant. Drafts run it on Submit (src/services/codeOfConductCheck.ts).

import type { Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import { AiLimitError, admitCodeOfConductCheck } from "./aiBudget.js";
import { checkTextAgainstCoC, getHubConfig } from "./codeOfConductAi.js";
import type { Suggestion } from "../models/assistant.js";

/** One thing the check found: a hard block, with the message the person sees. */
export type CodeOfConductFinding = Suggestion;

export const codeOfConduct = {
  /**
   * Check the text, labelled field by field, for the signed-in person. Hard
   * blocks come back as findings. `passed` is true only when the check ran
   * and found nothing: a hub whose budget is spent, or a model that is down,
   * leaves it false with no findings, and the submission goes to an admin as
   * usual (it fails open to human review). A person over their own hourly
   * count is refused (AiLimitError, 429).
   */
  async check(
    res: Response,
    fields: ReadonlyArray<{ label: string; text: string }>,
  ): Promise<{ findings: CodeOfConductFinding[]; passed: boolean }> {
    const user = getAuthUser(res);
    try {
      await admitCodeOfConductCheck(user.id);
      const findings = await checkTextAgainstCoC([...fields], await getHubConfig());
      return { findings, passed: findings.length === 0 };
    } catch (err) {
      if (err instanceof AiLimitError && !err.budget) throw err;
      console.error(
        "[coc-check] automated check unavailable, failing open to human review:",
        err instanceof Error ? err.message : err,
      );
      return { findings: [], passed: false };
    }
  },
};
