// Shared drafting-assistant routes — one surface for every process type.
// Dispatch is by :processType through the registry; a type whose handler
// declares no assistant config 404s here and shows no affordance in the UI.
//
// GET  /assistant/:processType/config             — public (form copy only)
// POST /assistant/:processType/drafts/:id/message — resident-gated
// POST /assistant/:processType/drafts/:id/review  — resident-gated

import { Router } from "express";
import {
  handleGetAssistantConfig,
  handleAssistantMessage,
  handleAssistantReview,
  handleAssistantSuggest,
} from "../controllers/assistantController.js";
import { requireResident } from "../middleware/auth.js";

const router = Router();

router.get("/:processType/config", handleGetAssistantConfig);
router.post("/:processType/drafts/:id/message", requireResident, handleAssistantMessage);
router.post("/:processType/drafts/:id/review", requireResident, handleAssistantReview);
router.post("/:processType/drafts/:id/suggest", requireResident, handleAssistantSuggest);

export default router;
