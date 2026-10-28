import { Router } from "express";
import {
  handleListProjects,
  handleGetProject,
  handleSetSentiment,
  handleCompleteProject,
} from "./controller.js";
import { requireResident } from "@civic-social/plugin-sdk/first-party";

const router = Router();

// A project is created through drafts and review. POST /projects, which
// published one with no review and no Code of Conduct check, was removed
// 2026-10-12.
router.get("/", handleListProjects);
router.get("/:id", handleGetProject);
router.post("/:id/sentiment", requireResident, handleSetSentiment);
// Comments and creator updates: POST/GET /process/:id/input (civic.input) —
// the shared module, so projects moderate like every other type.
router.post("/:id/complete", requireResident, handleCompleteProject);

export default router;
