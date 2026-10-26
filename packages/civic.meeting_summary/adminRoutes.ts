import { Router } from "express";
import {
  handleAdminGetMeetingSummary,
  handleAdminListMeetingSummaries,
  handleAcceptMeetingSummaryRevision,
  handleApproveMeetingSummary,
  handleDiscardMeetingSummaryRevision,
  handleBatchApproveMeetingSummaries,
  handleBatchDeleteMeetingSummaries,
  handlePatchMeetingSummary,
} from "./controller.js";

const router = Router();

// Meeting Summaries (batch routes before /:id to avoid Express treating them as an id)
router.post("/batch-approve", handleBatchApproveMeetingSummaries);
router.post("/batch-delete", handleBatchDeleteMeetingSummaries);
router.get("/", handleAdminListMeetingSummaries);
router.get("/:id", handleAdminGetMeetingSummary);
router.patch("/:id", handlePatchMeetingSummary);
router.post("/:id/approve", handleApproveMeetingSummary);
// Revision review — a regenerated summary waiting beside a published one.
// Neither route can take a page offline: the live version keeps serving.
router.post(
  "/:id/revision/accept",
  handleAcceptMeetingSummaryRevision,
);
router.post(
  "/:id/revision/discard",
  handleDiscardMeetingSummaryRevision,
);

export default router;
