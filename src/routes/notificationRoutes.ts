import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  handleGetReviewNotifications,
  handleMarkReviewsSeen,
} from "../controllers/reviewController.js";
import {
  handleGetEditNotifications,
  handleMarkEditsSeen,
} from "../controllers/editNotificationController.js";

const router = Router();

// requireAuth (not requireResident): admins poll this too, and an admin
// account may not have affirmed residency.
router.use(requireAuth);

router.get("/reviews/count", handleGetReviewNotifications);
router.post("/reviews/seen", handleMarkReviewsSeen);

// Edited processes this user supports — the supporter's badge (Adam,
// 2026-09-03), for people not on the email digest.
router.get("/edits", handleGetEditNotifications);
router.post("/edits/seen", handleMarkEditsSeen);

export default router;
