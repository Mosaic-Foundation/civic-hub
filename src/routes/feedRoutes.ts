import { Router } from "express";
import { handleGetFeed, handleGetFeedClosing, handleGetFeedMeta } from "../controllers/feedController.js";

const router = Router();

// Internal read model for the hub UI — NOT the spec surface (that is /events).
router.get("/", handleGetFeed);
// The hub's facts and card metadata for a feed read off /events.
router.get("/meta", handleGetFeedMeta);
// What is about to close: the feed's "closing soon" cards (Events 4).
router.get("/closing", handleGetFeedClosing);

export default router;
