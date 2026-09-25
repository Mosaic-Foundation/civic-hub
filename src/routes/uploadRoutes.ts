// Slice 9 — upload routes (post-image, future: link-preview cache warm).
//
// The upload route deliberately skips express.json() so busboy can stream
// the multipart body directly. The global app-level express.json() runs
// only on application/json requests, so multipart bypasses it naturally;
// no router-level disabling is required.

import { requirePlugin } from "../middleware/pluginGate.js";
import { Router } from "express";
import { requireAdmin, requireAnnouncementPoster, requireResident } from "../middleware/auth.js";
import {
  handleHubImageUpload,
  handlePostImageUpload,
} from "../controllers/uploadController.js";

const router = Router();

router.post(
  "/post-image",
  requirePlugin("announcement"),
  requireAnnouncementPoster,
  handlePostImageUpload,
);

router.post(
  "/project-image",
  requirePlugin("project"),
  requireResident,
  handlePostImageUpload,
);

// A screenshot on a bug report (feedback form). Same validation and bucket
// as the other images; signed-in residents only — the feedback form offers
// the picker only when signed in, and the service refuses a screenshot on
// an anonymous submission.
router.post(
  "/feedback-screenshot",
  requirePlugin("feedback"),
  requireResident,
  handlePostImageUpload,
);

// A hub's banner or logo, from the admin Settings page. Stored under the
// hub's own prefix in the bucket; the URL it returns is what the Identity
// section then saves to identity.banner_url / identity.logo_url.
router.post("/hub-image", requireAdmin, handleHubImageUpload);

export default router;
