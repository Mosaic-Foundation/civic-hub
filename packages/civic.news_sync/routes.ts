// News routes: GET /news/:id (public read).

import { Router } from "express";
import { handleGetNews } from "./controller.js";

const router = Router();
router.get("/:id", handleGetNews);

export default router;
