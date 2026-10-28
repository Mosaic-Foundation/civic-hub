// Proposal controller — handles HTTP request/response for proposal endpoints
//
// User-facing operations: support, list, detail. A proposal is created by
// submitting a draft for review (POST /proposals/drafts/:id/submit); the
// direct create route was removed 2026-10-12 (it skipped review).
// Admin operations are in adminController.ts.

import {
  ValidationError,
  route,
  resolveCallerUser,
  actOnProcess,
  readAsPage,
  viewFor,
  enrichCreators,
  getSampleProcessIds,
} from "@civic-social/plugin-sdk/first-party";
import {
  listProposals,
  getProposalSummary,
} from "./service.js";

/**
 * GET /proposals — list all proposals (optionally filtered by status)
 */
export const handleListProposals = route(async (req, res) => {
  const status = req.query.status as string | undefined;
  const validStatuses = ["submitted", "endorsed", "converted", "archived"];

  if (status && !validStatuses.includes(status)) {
    throw new ValidationError(`Invalid status filter. Valid values: ${validStatuses.join(", ")}`);
  }

  const proposals = await listProposals(status as any);
  const summaries = proposals.map(getProposalSummary);
  // Resolve every submitter in one query; attach creator name + admin
  // flag and redact the raw submitted_by id from this public list.
  // Cross-process list surface: public callers see plain "Resident"
  // (no number — each row is a different process).
  const enriched = await enrichCreators(summaries, {
    rawIdField: "submitted_by",
    audience: (await resolveCallerUser(req)) ? "member" : "public",
  });
  // Sample content (Phase 7): proposal id === its canonical processes row
  // id, so one lookup marks every seeded row for the badge.
  const sampleIds = await getSampleProcessIds();
  const withSample =
    sampleIds.size === 0
      ? enriched
      : enriched.map((p) =>
          sampleIds.has((p as { id: string }).id) ? { ...p, is_sample: true } : p,
        );
  res.json(withSample);
});

/**
 * GET /proposals/:id — get proposal detail
 */
export const handleGetProposal = route(async (req, res) => {
  // The proposal's read model through the shared read path (its adapter
  // builds the page's shape): bylines, "Resident N" for visitors, sample
  // badge and the per-caller has_supported, as every type's page gets them.
  res.json(await readAsPage(req, req.params.id as string, "civic.proposal", "Proposal not found"));
});

/**
 * POST /proposals/:id/support and DELETE /proposals/:id/support — support a
 * proposal, or withdraw support: process.support / process.unsupport through
 * the one action path (src/controllers/processController.ts, actOnProcess).
 */
export const handleSupportProposal = route(async (req, res) => {
  const id = req.params.id as string;
  const { result } = await actOnProcess(res, id, "process.support", {}, "civic.proposal");
  res.json({ support_count: result.support_count, status: result.status, view: await viewFor(res, id) });
});

export const handleUnsupportProposal = route(async (req, res) => {
  const id = req.params.id as string;
  const { result } = await actOnProcess(res, id, "process.unsupport", {}, "civic.proposal");
  res.json({ support_count: result.support_count, status: result.status, view: await viewFor(res, id) });
});
