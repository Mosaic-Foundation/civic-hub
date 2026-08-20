import { Router } from "express";
import { handleGetActivity } from "../controllers/eventController.js";

const router = Router();

// Dereference one activity by its event id — the target of every activity's
// own `id` IRI (`{baseUrl}/activities/{id}`).
router.get("/:id", handleGetActivity);

export default router;
