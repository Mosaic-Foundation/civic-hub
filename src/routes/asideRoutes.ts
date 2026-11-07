import { Router } from "express";
import { handleGetAside } from "../controllers/asideController.js";

const router = Router();

// The three-column layout's right column (ADR-019): deadlines, announcements, About.
router.get("/", handleGetAside);

export default router;
