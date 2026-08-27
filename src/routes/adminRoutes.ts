// Admin routes — proposal moderation and other admin surfaces.
// Every route requires the authenticated user's email to be listed in
// the CIVIC_ADMIN_EMAILS env var.

import { Router } from "express";
import {
  handleAdminListProposals,
  handleAdminGetProposal,
} from "../controllers/adminController.js";
import {
  handleAdminListVoteResults,
  handleAdminGetVoteResults,
  handlePatchVoteResults,
  handleApproveVoteResults,
} from "../controllers/adminVoteResultsController.js";
import {
  handleAdminListBriefs,
  handleAdminGetBrief,
  handlePatchBrief,
  handleApproveBrief,
} from "../controllers/adminBriefController.js";
import {
  handleAdminGetMeetingSummary,
  handleAdminListMeetingSummaries,
  handleAcceptMeetingSummaryRevision,
  handleApproveMeetingSummary,
  handleDiscardMeetingSummaryRevision,
  handleBatchApproveMeetingSummaries,
  handleBatchDeleteMeetingSummaries,
  handlePatchMeetingSummary,
} from "../controllers/meetingSummaryController.js";
import {
  handleGetSettings,
  handlePatchSettings,
} from "../controllers/adminSettingsController.js";
import {
  handleAdminListReviews,
  handleAdminGetReview,
  handleAdminApprove,
  handleAdminRequestChanges,
  handleAdminDecline,
} from "../controllers/reviewController.js";
import {
  handleGetModerationLog,
  handleHideComment,
  handleRemoveAnnouncement,
  handleRestoreAnnouncement,
  handleRestoreComment,
} from "../controllers/moderationController.js";
import {
  handleArchiveProcess,
  handleRestoreProcess,
  handleListArchivedProcesses,
} from "../controllers/adminArchiveController.js";
import { handleAdminListFeedback } from "../controllers/adminFeedbackController.js";
import { cleanOrphanedEvents } from "../services/processService.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

router.use(requireAdmin);

// Maintenance
router.post("/cleanup-orphaned-events", async (_req, res) => {
  try {
    const removed = await cleanOrphanedEvents();
    res.json({ message: `Removed ${removed} orphaned event(s).`, removed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    res.status(500).json({ error: msg });
  }
});

// Proposals
router.get("/proposals", handleAdminListProposals);
router.get("/proposals/:id", handleAdminGetProposal);

// Vote results (renamed from /admin/briefs in Slice 8.5; the underlying
// process type is civic.vote_results, formerly civic.brief).
router.get("/vote-results", handleAdminListVoteResults);
router.get("/vote-results/:id", handleAdminGetVoteResults);
router.patch("/vote-results/:id", handlePatchVoteResults);
router.post("/vote-results/:id/approve", handleApproveVoteResults);

// Briefs — the universal, admin-reviewed results for any closed process
// (civic.brief). New closures (conversation/proposal/project, and votes
// after migration) land here; legacy civic.vote_results keep their routes
// above for existing published records.
router.get("/briefs", handleAdminListBriefs);
router.get("/briefs/:id", handleAdminGetBrief);
router.patch("/briefs/:id", handlePatchBrief);
router.post("/briefs/:id/approve", handleApproveBrief);

// Meeting Summaries (batch routes before /:id to avoid Express treating them as an id)
router.post("/meeting-summaries/batch-approve", handleBatchApproveMeetingSummaries);
router.post("/meeting-summaries/batch-delete", handleBatchDeleteMeetingSummaries);
router.get("/meeting-summaries", handleAdminListMeetingSummaries);
router.get("/meeting-summaries/:id", handleAdminGetMeetingSummary);
router.patch("/meeting-summaries/:id", handlePatchMeetingSummary);
router.post("/meeting-summaries/:id/approve", handleApproveMeetingSummary);
// Revision review — a regenerated summary waiting beside a published one.
// Neither route can take a page offline: the live version keeps serving.
router.post(
  "/meeting-summaries/:id/revision/accept",
  handleAcceptMeetingSummaryRevision,
);
router.post(
  "/meeting-summaries/:id/revision/discard",
  handleDiscardMeetingSummaryRevision,
);

// Process reviews (collaborative admin review before publication)
router.get("/reviews", handleAdminListReviews);
router.get("/reviews/:reviewId", handleAdminGetReview);
router.post("/reviews/:reviewId/approve", handleAdminApprove);
router.post("/reviews/:reviewId/request-changes", handleAdminRequestChanges);
router.post("/reviews/:reviewId/decline", handleAdminDecline);

// Archive / restore (generic soft-remove across process types) + the
// admin Archived view. Archiving hides an item from the public list, direct
// fetch, feed, and digest while keeping it restorable.
router.get("/archived", handleListArchivedProcesses);
router.post("/processes/:id/archive", handleArchiveProcess);
router.post("/processes/:id/restore", handleRestoreProcess);

// Feedback archive (read-only). Everything residents sent through the
// feedback form, newest first, optionally filtered to one category.
// Read-only on purpose — see adminFeedbackController.
router.get("/feedback", handleAdminListFeedback);

// Hub settings (admin-configurable; overrides env var fallbacks)
router.get("/settings", handleGetSettings);
router.patch("/settings", handlePatchSettings);

// Moderation (Slice 11). Every action emits a restricted-visibility
// civic.process.updated event for the audit trail; the moderation log
// reads those events back. Routes deliberately mirror the resource
// they act on so admins can navigate between them in muscle memory.
router.post("/moderation/comments/:commentId/hide", handleHideComment);
router.post("/moderation/comments/:commentId/restore", handleRestoreComment);
router.post(
  "/moderation/announcements/:id/remove",
  handleRemoveAnnouncement,
);
router.post(
  "/moderation/announcements/:id/restore",
  handleRestoreAnnouncement,
);
router.get("/moderation/log", handleGetModerationLog);

export default router;
