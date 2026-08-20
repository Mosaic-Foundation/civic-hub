import { Router } from "express";
import { handleGetFeed } from "../controllers/feedController.js";

const router = Router();

// Internal read model for the hub UI — NOT the spec surface (that is /events).
router.get("/", handleGetFeed);

export default router;
