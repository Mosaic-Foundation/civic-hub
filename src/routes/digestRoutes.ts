// Digest routes — Slice 5.
//
// Three distinct mount points, each with different auth:
//   /internal/digest/run         — CRON_SECRET bearer, no user auth
//   /unsubscribe/digest          — token-as-credential, no user auth
//   /user/settings/digest        — requireAuth (session token)
//
// Kept in one file for simplicity; app.ts mounts each on its own path.

import { Router } from "express";
import {
  handlePatchDigestSubscription,
  handleRunDigest,
  handleUnsubscribeDigest,
} from "../controllers/digestController.js";
import { requireAuth } from "../middleware/auth.js";
import { withMigrationDefaultHub } from "../services/cronHubs.js";

export const digestCronRouter = Router();
// Phase 2a bridge: the digest reads per-hub data but does not yet iterate
// hubs, so it runs as the migration-default hub (see withMigrationDefaultHub).
digestCronRouter.get("/digest/run", (req, res, next) => {
  withMigrationDefaultHub(() => handleRunDigest(req, res)).catch(next);
});

export const digestUnsubscribeRouter = Router();
digestUnsubscribeRouter.get("/digest", handleUnsubscribeDigest);

export const userSettingsRouter = Router();
userSettingsRouter.patch("/digest", requireAuth, handlePatchDigestSubscription);
