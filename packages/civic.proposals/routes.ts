// Proposal routes — user-facing proposal submission and endorsement
//
// GET  /proposals           — list proposals                (public)
// GET  /proposals/:id       — get proposal detail           (public)
// POST /proposals/:id/support — endorse a proposal          (requireResident)
// DELETE /proposals/:id/support — withdraw support           (requireResident)
//
// A proposal is created through drafts and review. POST /proposals, which
// published one with no review and no Code of Conduct check, was removed
// 2026-10-12.

import { Router } from "express";
import {
  handleListProposals,
  handleGetProposal,
  handleSupportProposal,
  handleUnsupportProposal,
} from "./controller.js";
import { requireResident } from "@civic-social/plugin-sdk/first-party";

const router = Router();

router.get("/", handleListProposals);
router.get("/:id", handleGetProposal);
router.post("/:id/support", requireResident, handleSupportProposal);
router.delete("/:id/support", requireResident, handleUnsupportProposal);

export default router;
