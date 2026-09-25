// Digest routes — Slice 5.
//
// Two mount points, each with different auth:
//   /unsubscribe/digest          — token-as-credential, no user auth
//   /user/settings/digest        — requireAuth (session token)
//
// The scheduled send is the "digest" job, mounted from src/jobs/registry.ts.

import { Router } from "express";
import {
  handlePatchDigestSubscription,
  handleUnsubscribeDigest,
} from "../controllers/digestController.js";
import { requireAuth } from "../middleware/auth.js";

export const digestUnsubscribeRouter = Router();
digestUnsubscribeRouter.get("/digest", handleUnsubscribeDigest);

export const userSettingsRouter = Router();
userSettingsRouter.patch("/digest", requireAuth, handlePatchDigestSubscription);
