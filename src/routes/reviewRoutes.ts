import { Router } from "express";
import { requireResident } from "../middleware/auth.js";
import {
  handleRevise,
  handleWithdraw,
  handleReopen,
  handleGetMyReviews,
  handleGetReview,
} from "../controllers/reviewController.js";

const router = Router();

router.use(requireResident);

// No generic POST /submit: every type is created through its own drafts
// route, which runs the Code of Conduct check and the type's validation
// (audit A8, 2026-10-11). submitAsCreator is the one funnel behind them.
router.get("/mine", handleGetMyReviews);
router.get("/:reviewId", handleGetReview);
router.post("/:reviewId/revise", handleRevise);
router.post("/:reviewId/withdraw", handleWithdraw);
router.post("/:reviewId/reopen", handleReopen);

export default router;
