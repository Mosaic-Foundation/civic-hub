import { Router } from "express";
import { handleAdminListProposals, handleAdminGetProposal } from "./adminController.js";

const router = Router();

// Proposals
router.get("/", handleAdminListProposals);
router.get("/:id", handleAdminGetProposal);

export default router;
