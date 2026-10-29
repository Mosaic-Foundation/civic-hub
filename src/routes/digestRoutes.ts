// Digest routes — Slice 5; a person's notices and look, design pass 2026-10-29.
//
// Two mount points, each with different auth:
//   /unsubscribe/digest, /unsubscribe/notices  — token-as-credential, no user auth
//   /user/settings/digest, /notices, /appearance — requireAuth (session token)
//
// The scheduled send is the "digest" job, mounted from src/jobs/registry.ts.

import { Router } from "express";
import {
  handlePatchAppearance,
  handlePatchDigestSubscription,
  handlePatchNotices,
  handleUnsubscribeDigest,
  handleUnsubscribeNotices,
} from "../controllers/digestController.js";
import { requireAuth } from "../middleware/auth.js";

export const digestUnsubscribeRouter = Router();
digestUnsubscribeRouter.get("/digest", handleUnsubscribeDigest);
digestUnsubscribeRouter.get("/notices", handleUnsubscribeNotices);

export const userSettingsRouter = Router();
userSettingsRouter.patch("/digest", requireAuth, handlePatchDigestSubscription);
userSettingsRouter.patch("/notices", requireAuth, handlePatchNotices);
userSettingsRouter.patch("/appearance", requireAuth, handlePatchAppearance);
