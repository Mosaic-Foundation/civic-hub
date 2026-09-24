// News-sync routes.
//
// Mount point: /internal/news-sync/run, gated by CRON_SECRET bearer auth
// (shared with the digest + meeting-summary crons). Triggered daily by Vercel
// Cron, also manually triggerable with the same auth for backfill or testing.
//
// DEPRECATED ALIAS. The module was named for the first hub that used it, and
// production's vercel.json on `main` still schedules the old path. It stays
// mounted, to the same handler, until the cutover deploys this branch's
// vercel.json; then it is removed together with its allow-list entry in
// scripts/place-name-allowlist.txt.

import { Router } from "express";
import { handleRunNewsSync } from "../controllers/newsSyncController.js";

export const NEWS_SYNC_RUN_PATH = "/news-sync/run";

/** @deprecated Remove after the multi-tenant cutover. */
export const LEGACY_NEWS_SYNC_RUN_PATH = "/floyd-news-sync/run";

export const newsSyncCronRouter = Router();
newsSyncCronRouter.get(NEWS_SYNC_RUN_PATH, handleRunNewsSync);
newsSyncCronRouter.get(LEGACY_NEWS_SYNC_RUN_PATH, (req, res) => {
  console.warn(
    `[news-sync] called on the deprecated path /internal${LEGACY_NEWS_SYNC_RUN_PATH}; ` +
      `schedule /internal${NEWS_SYNC_RUN_PATH} instead`,
  );
  return handleRunNewsSync(req, res);
});
