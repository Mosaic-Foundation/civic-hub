import { Router } from "express";
import { handleRemoveAnnouncement, handleRestoreAnnouncement } from "./adminController.js";

const router = Router();

// Moderation (Slice 11): remove and restore an announcement. Every action
// emits a restricted-visibility civic.process.updated event for the audit
// trail; the hub's moderation log reads those events back.
router.post("/:id/remove", handleRemoveAnnouncement);
router.post("/:id/restore", handleRestoreAnnouncement);

export default router;
