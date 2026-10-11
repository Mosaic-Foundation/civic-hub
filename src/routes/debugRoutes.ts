// Debug routes — seed data for rapid testing
// NOT for production use
//
// POST, and a hub admin's (Audit 2, 2026-10-11). It wipes the hub's
// processes, events, accounts and sessions, so it was never safe as an
// unauthenticated GET: any page could trigger it cross-site. It also refuses
// to run unless CIVIC_ALLOW_SEED=true, and never with NODE_ENV=production
// (src/config/devFlags.ts).

import { Router } from "express";
import { handleSeed } from "../controllers/debugController.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

router.post("/seed", requireAdmin, handleSeed);

export default router;
