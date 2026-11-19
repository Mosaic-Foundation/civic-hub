// Shared drafting-assistant routes — one surface for every process type.
// Dispatch is by :processType through the registry; a type whose handler
// declares no assistant config 404s here and shows no affordance in the UI.
//
// GET  /assistant/:processType/config             — public (form copy only)
// POST /assistant/:processType/drafts/:id/message — resident-gated
// POST /assistant/:processType/drafts/:id/suggest — resident-gated
//
// The AI chat (/message) and the suggestions (/suggest) are the Writing
// assistant feature's (features/assistant/routes.ts), mounted after this behind
// plugin.assistant.enabled. /config is the form's copy and is not gated. The Code of Conduct check runs at Submit, assistant or
// not (draftController); its older on-demand route here,
// /drafts/:id/review, was removed 2026-10-13 (Actions slice), a release
// after Submit took it over.

import { Router } from "express";
import { handleGetAssistantConfig } from "../controllers/assistantController.js";

const router = Router();

router.get("/:processType/config", handleGetAssistantConfig);

export default router;
