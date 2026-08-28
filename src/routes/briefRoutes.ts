import { Router } from "express";
import {
  handleGetBrief,
  handleListBriefs,
  handlePostBriefResponse,
} from "../controllers/briefController.js";
import { requireOfficial } from "../middleware/auth.js";

const router = Router();

// The outcomes index. Declared before /:id so the bare path is not captured
// as a brief id.
router.get("/", handleListBriefs);

// Public — no auth required. Returns 404 for unpublished records.
router.get("/:id", handleGetBrief);

// An official's public response to a published brief. requireOfficial is
// the who (an account holding an office); the controller's respondGate is
// the when (published briefs only).
router.post("/:id/response", requireOfficial, handlePostBriefResponse);

export default router;
