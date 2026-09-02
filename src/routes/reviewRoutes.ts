import { Router } from "express";
import { requireResident } from "../middleware/auth.js";
import {
  handleSubmitForReview,
  handleRevise,
  handleWithdraw,
  handleReopen,
  handleGetMyReviews,
  handleGetReview,
} from "../controllers/reviewController.js";

const router = Router();

router.use(requireResident);

router.post("/submit", handleSubmitForReview);
router.get("/mine", handleGetMyReviews);
router.get("/:reviewId", handleGetReview);
router.post("/:reviewId/revise", handleRevise);
router.post("/:reviewId/withdraw", handleWithdraw);
router.post("/:reviewId/reopen", handleReopen);

export default router;
