import { Router } from "express";
import {
  handleGetBrief,
  handleListBriefs,
} from "../controllers/briefController.js";

const router = Router();

// The outcomes index. Declared before /:id so the bare path is not captured
// as a brief id.
router.get("/", handleListBriefs);

// Public — no auth required. Returns 404 for unpublished records.
router.get("/:id", handleGetBrief);

export default router;
