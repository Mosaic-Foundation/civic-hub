// Member routes (members and invites slice, 2026-10-14)
//
// GET  /members/summary  — "N members" and the avatar stack (public)
// GET  /members          — the Members page (joined members only)
// POST /members/invites  — "Share this hub": email invites (joined members only)
//
// The first two are the Members plugin's (404 while it is off; its threshold
// in membersController). Invites are the hub's own and stay on either way
// (Adam, 2026-10-14).

import { Router } from "express";
import { requireResident } from "../middleware/auth.js";
import { requirePlugin } from "../middleware/pluginGate.js";
import { handleListMembers, handleMemberSummary, handleSendInvites } from "../controllers/membersController.js";

const router = Router();

router.get("/summary", requirePlugin("members"), handleMemberSummary);
router.get("/", requirePlugin("members"), requireResident, handleListMembers);
router.post("/invites", requireResident, handleSendInvites);

export default router;
