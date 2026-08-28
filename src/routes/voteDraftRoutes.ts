import { Router } from "express";
import {
  handleCreateVoteDraft,
  handleListVoteDrafts,
  handleGetVoteDraft,
  handleUpdateVoteDraft,
  handleSubmitVoteDraft,
} from "../controllers/voteDraftController.js";
import { requireResident } from "../middleware/auth.js";

// Assistant conversation + CoC review moved to the shared /assistant
// routes (assistantRoutes.ts), dispatched on process type via the registry.

const router = Router();

router.post("/", requireResident, handleCreateVoteDraft);
router.get("/", requireResident, handleListVoteDrafts);
router.get("/:id", requireResident, handleGetVoteDraft);
router.patch("/:id", requireResident, handleUpdateVoteDraft);
router.post("/:id/submit", requireResident, handleSubmitVoteDraft);

export default router;
