import { Router } from "express";
import {
  handleCreateProjectDraft,
  handleGetProjectDraft,
  handleUpdateProjectDraft,
  handleSubmitProjectDraft,
} from "../controllers/projectDraftController.js";
import { requireAuth, requireResident } from "../middleware/auth.js";

// Assistant conversation + CoC review moved to the shared /assistant
// routes (assistantRoutes.ts), dispatched on process type via the registry.

const router = Router();

router.post("/", requireResident, handleCreateProjectDraft);
router.get("/:id", requireAuth, handleGetProjectDraft);
router.patch("/:id", requireAuth, handleUpdateProjectDraft);
router.post("/:id/submit", requireResident, handleSubmitProjectDraft);

export default router;
