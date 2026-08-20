import { Router } from "express";
import { handleGetActivityCollection } from "../controllers/eventController.js";

const router = Router();

// The AS2 activity collection — the hub's public wire surface.
router.get("/", handleGetActivityCollection);

export default router;
