import { Router } from "express";
import { handleGetVoteResults } from "./controller.js";

const router = Router();

// Public — no auth required. Returns 404 for unpublished records.
router.get("/:id", handleGetVoteResults);

export default router;
