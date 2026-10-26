import { Router } from "express";
import {
  handleAdminListVoteResults,
  handleAdminGetVoteResults,
  handlePatchVoteResults,
  handleApproveVoteResults,
} from "./adminController.js";

const router = Router();

// Vote results (renamed from /admin/briefs in Slice 8.5; the underlying
// process type is civic.vote_results, formerly civic.brief).
router.get("/", handleAdminListVoteResults);
router.get("/:id", handleAdminGetVoteResults);
router.patch("/:id", handlePatchVoteResults);
router.post("/:id/approve", handleApproveVoteResults);

export default router;
