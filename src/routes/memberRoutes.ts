// "Share this hub" (members and invites slice, 2026-10-14)
//
// POST /members/invites  email invites (joined members only)
//
// The space's own, on whether the Members plugin is on or off (Adam,
// 2026-10-14). The count, the faces and the Members page (GET /members,
// GET /members/summary) are the plugin's (features/members, kernel step 4).

import { Router } from "express";
import { requireResident } from "../middleware/auth.js";
import { handleSendInvites } from "../controllers/membersController.js";

const router = Router();

router.post("/invites", requireResident, handleSendInvites);

export default router;
