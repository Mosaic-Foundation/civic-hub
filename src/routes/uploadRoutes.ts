// Slice 9 — upload routes (post-image, future: link-preview cache warm).
//
// The upload route deliberately skips express.json() so busboy can stream
// the multipart body directly. The global app-level express.json() runs
// only on application/json requests, so multipart bypasses it naturally;
// no router-level disabling is required.

import { Router } from "express";
import { requireAnnouncementPoster, requireResident } from "../middleware/auth.js";
import { handlePostImageUpload } from "../controllers/uploadController.js";

const router = Router();

router.post(
  "/post-image",
  requireAnnouncementPoster,
  handlePostImageUpload,
);

router.post(
  "/project-image",
  requireResident,
  handlePostImageUpload,
);

// A screenshot on a bug report (feedback form). Same validation and bucket
// as the other images; signed-in residents only — the feedback form offers
// the picker only when signed in, and the service refuses a screenshot on
// an anonymous submission.
router.post(
  "/feedback-screenshot",
  requireResident,
  handlePostImageUpload,
);

export default router;
