// Announcement routes.
//
// POST /announcement          — create (Board or admin)
// PATCH /announcement/:id     — edit (author-only unless admin)
// GET /announcement/:id       — public read
// GET /announcements          — public list (its own router, mounted at
//                                /announcements by ./index.ts)

import { Router } from "express";
import {
  handleCreateAnnouncement,
  handleGetAnnouncement,
  handleListAnnouncements,
  handleUpdateAnnouncement,
} from "./controller.js";
import { requireAuthor } from "@civic-social/plugin-sdk";

const router = Router();

router.post("/", requireAuthor, handleCreateAnnouncement);
router.patch("/:id", requireAuthor, handleUpdateAnnouncement);
router.get("/:id", handleGetAnnouncement);

// Public list — separate path so it doesn't collide with /announcement/:id
export const listRouter = Router();
listRouter.get("/", handleListAnnouncements);

export default router;
