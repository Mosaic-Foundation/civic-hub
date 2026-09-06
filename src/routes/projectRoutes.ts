import { Router } from "express";
import {
  handleCreateProject,
  handleListProjects,
  handleGetProject,
  handleSetSentiment,
  handleCompleteProject,
} from "../controllers/projectController.js";
import { requireResident } from "../middleware/auth.js";

const router = Router();

router.post("/", requireResident, handleCreateProject);
router.get("/", handleListProjects);
router.get("/:id", handleGetProject);
router.post("/:id/sentiment", requireResident, handleSetSentiment);
// Comments and creator updates: POST/GET /process/:id/input (civic.input) —
// the shared module, so projects moderate like every other type.
router.post("/:id/complete", requireResident, handleCompleteProject);

export default router;
