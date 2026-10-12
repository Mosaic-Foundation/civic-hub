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

import { UnauthorizedError } from "../errors/index.js";
import { route } from "../http/route.js";
import { caller, requireStepUpCode } from "./adminStepUp.js";
import { removeSampleContent, sampleContentSummary } from "../services/sampleContent.js";

export { handleRequestStepUpCode as handleRequestSampleRemovalCode } from "./adminStepUp.js";

export const handleGetSampleContent = route(async (_req, res) => {
  res.json(await sampleContentSummary());
});

export const handleRemoveSampleContent = route(async (req, res) => {
  const user = caller(res);
  if (!user) {
    throw new UnauthorizedError("Authentication required");
  }
  const body = (req.body ?? {}) as { code?: unknown };
  await requireStepUpCode(req, res, body.code);
  const result = await removeSampleContent(user.email);
  res.json({ removed: result.summary, deleted: result.deleted, summary: await sampleContentSummary() });
});
