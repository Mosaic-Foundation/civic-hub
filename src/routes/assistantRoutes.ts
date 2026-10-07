// Shared drafting-assistant routes — one surface for every process type.
// Dispatch is by :processType through the registry; a type whose handler
// declares no assistant config 404s here and shows no affordance in the UI.
//
// GET  /assistant/:processType/config             — public (form copy only)
// POST /assistant/:processType/drafts/:id/message — resident-gated
// POST /assistant/:processType/drafts/:id/review  — resident-gated
// POST /assistant/:processType/drafts/:id/suggest — resident-gated
//
// The Writing assistant plugin (plugin.assistant.enabled) gates only the AI
// chat (/message) and the suggestions (/suggest). The Code of Conduct check
// (/review) is moderation, not writing help, so it runs with the assistant
// off: every draft must still pass it before it can be submitted (Adam,
// 2026-10-07). /config is the form's copy and is not gated either.

import { Router } from "express";
import {
  handleGetAssistantConfig,
  handleAssistantMessage,
  handleAssistantReview,
  handleAssistantSuggest,
} from "../controllers/assistantController.js";
import { requireResident } from "../middleware/auth.js";
import { requirePlugin } from "../middleware/pluginGate.js";

const router = Router();

router.get("/:processType/config", handleGetAssistantConfig);
router.post("/:processType/drafts/:id/message", requirePlugin("assistant"), requireResident, handleAssistantMessage);
router.post("/:processType/drafts/:id/review", requireResident, handleAssistantReview);
router.post("/:processType/drafts/:id/suggest", requirePlugin("assistant"), requireResident, handleAssistantSuggest);

export default router;
