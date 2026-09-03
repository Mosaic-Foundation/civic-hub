// Share metadata — one public endpoint for every process type's page.
//   GET /share/meta?path=/section/id
import { Router } from "express";
import { handleGetShareMeta } from "../controllers/shareController.js";

const router = Router();
router.get("/meta", handleGetShareMeta);
export default router;
