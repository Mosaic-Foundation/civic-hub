// Meeting-summary routes.
//
//   /meeting-summary/:id            — public GET of published summaries
//
// The scheduled run is the "meeting_summary" job (./job.ts), which the hub's
// job list (src/jobs/registry.ts) schedules. Admin routes (GET/PATCH list,
// GET/POST :id/approve) are ./adminRoutes.ts, mounted on /admin/meeting-summaries
// behind the hub's admin check.

import { Router } from "express";
import { handleGetPublicMeetingSummary } from "./controller.js";

const publicRouter = Router();
publicRouter.get("/:id", handleGetPublicMeetingSummary);

export default publicRouter;
