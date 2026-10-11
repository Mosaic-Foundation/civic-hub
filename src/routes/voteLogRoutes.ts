import { Router } from "express";
import { handleGetVoteLog, handleVerifyReceipt, handleClaimReceipt } from "../controllers/voteLogController.js";
import { requireResident } from "../middleware/auth.js";

const router = Router();

// GET /votes/:id/log — public vote audit log (only after close)
router.get("/:id/log", handleGetVoteLog);

// POST /votes/:id/verify { receipt } — receipt verification. A POST, so the
// receipt is in the body and no request log records it (2026-10-10; the GET
// with ?receipt= is gone).
router.post("/:id/verify", handleVerifyReceipt);

// POST /votes/:id/claim-receipt — an early voter's browser collects a change
// key for the ballot they cast before 2026-10-10 (once).
router.post("/:id/claim-receipt", requireResident, handleClaimReceipt);

export default router;
