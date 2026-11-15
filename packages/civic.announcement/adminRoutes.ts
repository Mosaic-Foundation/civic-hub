import { Router } from "express";
import {
  handleAdminListAnnouncements,
  handlePinAnnouncement,
  handleRemoveAnnouncement,
  handleRestoreAnnouncement,
  handleUnpinAnnouncement,
} from "./adminController.js";

const router = Router();

// Moderation (Slice 11): remove and restore an announcement. Every action
// emits a restricted-visibility civic.process.updated event for the audit
// trail; the hub's moderation log reads those events back.
router.post("/:id/remove", handleRemoveAnnouncement);
router.post("/:id/restore", handleRestoreAnnouncement);

export default router;

// Admin → Announcements (Adam, 2026-11-15): the pinned and urgent ones, and
// pin / unpin. Mounted at /admin/announcements (./index.ts).
export const boardRouter = Router();
boardRouter.get("/", handleAdminListAnnouncements);
boardRouter.post("/:id/pin", handlePinAnnouncement);
boardRouter.post("/:id/unpin", handleUnpinAnnouncement);
