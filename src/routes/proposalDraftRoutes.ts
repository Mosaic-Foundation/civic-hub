import { Router } from "express";
import {
  handleCreateDraft,
  handleListDrafts,
  handleGetDraft,
  handleUpdateDraft,
  handleSubmitDraft,
} from "../controllers/proposalDraftController.js";
import { requireResident } from "../middleware/auth.js";

// Assistant conversation + CoC review moved to the shared /assistant
// routes (assistantRoutes.ts), dispatched on process type via the registry.

const router = Router();

router.post("/", requireResident, handleCreateDraft);
router.get("/", requireResident, handleListDrafts);
router.get("/:id", requireResident, handleGetDraft);
router.patch("/:id", requireResident, handleUpdateDraft);
router.post("/:id/submit", requireResident, handleSubmitDraft);

export default router;
