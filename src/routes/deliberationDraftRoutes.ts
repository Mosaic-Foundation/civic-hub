import { Router } from "express";
import {
  handleCreateDeliberationDraft,
  handleGetDeliberationDraft,
  handleUpdateDeliberationDraft,
  handleSubmitDeliberationDraft,
} from "../controllers/deliberationDraftController.js";
import { requireResident } from "../middleware/auth.js";

// Assistant conversation + CoC review live on the shared /assistant
// routes (assistantRoutes.ts), dispatched on process type via the registry.

const router = Router();

router.post("/", requireResident, handleCreateDeliberationDraft);
router.get("/:id", requireResident, handleGetDeliberationDraft);
router.patch("/:id", requireResident, handleUpdateDeliberationDraft);
router.post("/:id/submit", requireResident, handleSubmitDeliberationDraft);

export default router;
