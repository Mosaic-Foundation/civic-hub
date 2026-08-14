import { Router } from "express";
import { handleGetBrief } from "../controllers/briefController.js";

const router = Router();

// Public — no auth required. Returns 404 for unpublished records.
router.get("/:id", handleGetBrief);

export default router;
