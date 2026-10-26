import { Router } from "express";
import {
  handleAdminListBriefs,
  handleAdminGetBrief,
  handlePatchBrief,
  handleApproveBrief,
  handleRegenerateBrief,
  handlePublishBriefRevision,
  handleDiscardBriefRevision,
} from "./adminController.js";

const router = Router();

// Briefs — the universal, admin-reviewed results for any closed process
// (civic.brief). New closures (conversation/proposal/project, and votes
// after migration) land here; legacy civic.vote_results keep their routes
// (the vote-results package) for existing published records.
router.get("/", handleAdminListBriefs);
router.get("/:id", handleAdminGetBrief);
router.patch("/:id", handlePatchBrief);
router.post("/:id/approve", handleApproveBrief);
// Regenerate (Actions slice): make it again; publish or discard the new version.
router.post("/:id/regenerate", handleRegenerateBrief);
router.post("/:id/revision/publish", handlePublishBriefRevision);
router.post("/:id/revision/discard", handleDiscardBriefRevision);

export default router;
