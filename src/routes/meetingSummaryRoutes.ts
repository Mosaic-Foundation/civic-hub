// Meeting-summary routes.
//
//   /meeting-summary/:id            — public GET of published summaries
//
// The scheduled run is the "meeting_summary" job, mounted from
// src/jobs/registry.ts. Admin routes (GET/PATCH list, GET/POST :id/approve)
// are mounted on /admin/meeting-summaries via adminRoutes.ts, reusing the
// existing requireAdmin guard.

import { Router } from "express";
import { handleGetPublicMeetingSummary } from "../controllers/meetingSummaryController.js";

const publicRouter = Router();
publicRouter.get("/:id", handleGetPublicMeetingSummary);

export default publicRouter;
