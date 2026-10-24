// A hub admin's sample-content control (Phase 7), in every mode.
//
//   GET  /admin/hub/sample-content               what removal would take
//   POST /admin/hub/sample-content/request-code  emails the caller a code
//   POST /admin/hub/sample-content/remove        { code } removes it all
//   DELETE /admin/hub/sample-content/:id         deletes one sample, no code
//                                                 (admin menu slice, 2026-10-13)
//
// The same step-up as a mode or roster change (controllers/adminStepUp.ts):
// removal cannot be undone, and it can take real people's input with it.
// Graduating out of demo asks the same question through POST /admin/hub/mode
// (`remove_sample_content`), which calls the same service.

import { NotFoundError, UnauthorizedError } from "../errors/index.js";
import { route } from "../http/route.js";
import { caller, requireStepUpCode } from "./adminStepUp.js";
import { auditActor } from "../services/hubAdminAudit.js";
import {
  deleteOneSample,
  listSampleItems,
  removeSampleContent,
  sampleContentSummary,
} from "../services/sampleContent.js";
import { processDetailPath } from "../processes/registry.js";

/** The summary, and each sample an admin can delete on its own, with its page. */
async function summaryWithItems() {
  const [summary, items] = await Promise.all([sampleContentSummary(), listSampleItems()]);
  return { ...summary, items: items.map((i) => ({ ...i, path: processDetailPath(i.type, i.id) })) };
}

export { handleRequestStepUpCode as handleRequestSampleRemovalCode } from "./adminStepUp.js";

export const handleGetSampleContent = route(async (_req, res) => {
  res.json(await summaryWithItems());
});

export const handleDeleteOneSample = route(async (req, res) => {
  const user = caller(res);
  if (!user) {
    throw new UnauthorizedError("Authentication required");
  }
  const result = await deleteOneSample(String(req.params.id), auditActor(user));
  if (!result) throw new NotFoundError("No sample with that id on this hub.");
  res.json({ deleted: result.item, rows: result.deleted, cleared: result.cleared, summary: await summaryWithItems() });
});

export const handleRemoveSampleContent = route(async (req, res) => {
  const user = caller(res);
  if (!user) {
    throw new UnauthorizedError("Authentication required");
  }
  const body = (req.body ?? {}) as { code?: unknown };
  await requireStepUpCode(req, res, body.code);
  const result = await removeSampleContent(auditActor(user));
  res.json({ removed: result.summary, deleted: result.deleted, summary: await summaryWithItems() });
});
