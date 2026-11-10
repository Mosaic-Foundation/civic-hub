import { Router } from "express";
import { handleGetVoteLog, handleVerifyReceipt } from "./controller.js";
import { requireResident } from "@civic-social/plugin-sdk/first-party";

const router = Router();

// GET /votes/:id/log — public vote audit log (only after close)
router.get("/:id/log", handleGetVoteLog);

// POST /votes/:id/verify { receipt } — receipt verification. A POST, so the
// receipt is in the body and no request log records it (2026-10-10; the GET
// with ?receipt= is gone).
router.post("/:id/verify", handleVerifyReceipt);

export default router;
