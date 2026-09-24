// Admin digest routes — Slice 16.
//
// Single mount point: /internal/admin-digest/run, gated by
// CRON_SECRET bearer auth (shared with the user-digest +
// meeting-summary + floyd-news-sync crons). Triggered daily by
// Vercel Cron, manually triggerable with the same auth for testing.

import { Router } from "express";
import { handleRunAdminDigest } from "../controllers/adminDigestController.js";
import { withMigrationDefaultHub } from "../services/cronHubs.js";

export const adminDigestCronRouter = Router();
// Phase 2a bridge: runs as the migration-default hub until the admin digest
// iterates hubs (Phase 2b). See withMigrationDefaultHub.
adminDigestCronRouter.get("/admin-digest/run", (req, res, next) => {
  withMigrationDefaultHub(() => handleRunAdminDigest(req, res)).catch(next);
});
