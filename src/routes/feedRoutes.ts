import { Router } from "express";
import { handleGetFeed, handleGetFeedMeta } from "../controllers/feedController.js";

const router = Router();

// Internal read model for the hub UI — NOT the spec surface (that is /events).
router.get("/", handleGetFeed);
// The hub's facts and card metadata for a feed read off /events.
router.get("/meta", handleGetFeedMeta);

export default router;
