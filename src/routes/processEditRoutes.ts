// Creator edits of a live process — universal (mounted once on /process).
//   GET  /process/:id/edits        public: the visible edit history
//   GET  /process/:id/edit-policy  signed in: may THIS viewer edit, what is locked
//   POST /process/:id/edit         creator or admin: reopen the draft to edit
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { handleGetEditPolicy, handleListEdits, handleStartEdit } from "../controllers/processEditController.js";

const router = Router();
router.get("/:id/edits", handleListEdits);
router.get("/:id/edit-policy", requireAuth, handleGetEditPolicy);
router.post("/:id/edit", requireAuth, handleStartEdit);
export default router;
