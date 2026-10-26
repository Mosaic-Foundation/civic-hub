import { Router } from "express";
import {
  handleGetWordcloud,
  handleGetWordcloudCloud,
  handleGetWordcloudResponses,
} from "./controller.js";

const router = Router();

// Read layer — public (cloud data is the live result)
router.get("/:id/cloud", handleGetWordcloudCloud);
router.get("/:id/responses", handleGetWordcloudResponses);
router.get("/:id", handleGetWordcloud);

export default router;
