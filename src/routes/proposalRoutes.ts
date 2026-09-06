// Proposal routes — user-facing proposal submission and endorsement
//
// POST /proposals           — submit a new proposal         (requireResident)
// GET  /proposals           — list proposals                (public)
// GET  /proposals/:id       — get proposal detail           (public)
// POST /proposals/:id/support — endorse a proposal          (requireResident)

import { Router } from "express";
import {
  handleSubmitProposal,
  handleListProposals,
  handleGetProposal,
  handleSupportProposal,
  handleUnsupportProposal,
} from "../controllers/proposalController.js";
import { requireResident } from "../middleware/auth.js";

const router = Router();

router.post("/", requireResident, handleSubmitProposal);
router.get("/", handleListProposals);
router.get("/:id", handleGetProposal);
router.post("/:id/support", requireResident, handleSupportProposal);
router.delete("/:id/support", requireResident, handleUnsupportProposal);

export default router;
