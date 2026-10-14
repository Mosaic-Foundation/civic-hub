// Member routes (members and invites slice, 2026-10-14)
//
// GET  /members/summary  — "N members" and the avatar stack (public)
// GET  /members          — the Members page (joined members only)
// POST /members/invites  — "Share this hub": email invites (joined members only)

import { Router } from "express";
import { requireResident } from "../middleware/auth.js";
import { handleListMembers, handleMemberSummary, handleSendInvites } from "../controllers/membersController.js";

const router = Router();

router.get("/summary", handleMemberSummary);
router.get("/", requireResident, handleListMembers);
router.post("/invites", requireResident, handleSendInvites);

export default router;
