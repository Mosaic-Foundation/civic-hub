// A hub admin's sample-content control (Phase 7), in every mode.
//
//   GET  /admin/hub/sample-content               what removal would take
//   POST /admin/hub/sample-content/request-code  emails the caller a code
//   POST /admin/hub/sample-content/remove        { code } removes it all
//
// The same step-up as a mode or roster change (controllers/adminStepUp.ts):
// removal cannot be undone, and it can take real people's input with it.
// Graduating out of demo asks the same question through POST /admin/hub/mode
// (`remove_sample_content`), which calls the same service.

import type { Request, Response } from "express";
import { caller, requireStepUpCode } from "./adminStepUp.js";
import { removeSampleContent, sampleContentSummary } from "../services/sampleContent.js";

export { handleRequestStepUpCode as handleRequestSampleRemovalCode } from "./adminStepUp.js";

export async function handleGetSampleContent(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await sampleContentSummary());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

export async function handleRemoveSampleContent(req: Request, res: Response): Promise<void> {
  const user = caller(res);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const body = (req.body ?? {}) as { code?: unknown };
  if (!(await requireStepUpCode(res, body.code))) return;
  try {
    const result = await removeSampleContent(user.email);
    res.json({ removed: result.summary, deleted: result.deleted, summary: await sampleContentSummary() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
