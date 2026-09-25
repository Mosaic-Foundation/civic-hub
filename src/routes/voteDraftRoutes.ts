import { Router } from "express";
import { voteDurationLimitsSync } from "../services/hubSettings.js";
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
// Before "/:id", which would otherwise take "duration-limits" as a draft id.
router.get("/duration-limits", requireResident, (_req, res) => {
  const { minDays, maxDays, defaultDays } = voteDurationLimitsSync();
  res.json({ min_days: minDays, max_days: maxDays, default_days: defaultDays });
});
router.get("/:id", requireResident, handleGetVoteDraft);
router.patch("/:id", requireResident, handleUpdateVoteDraft);
router.post("/:id/submit", requireResident, handleSubmitVoteDraft);

export default router;
