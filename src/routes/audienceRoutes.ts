import { Router } from "express";
import { handleGetAudience } from "../controllers/eventController.js";

const router = Router();

// Dereference an audience collection — the target of a restricted activity's
// `to` (`{baseUrl}/audiences/admins`). Self-describing; items never served.
router.get("/:name", handleGetAudience);

export default router;
