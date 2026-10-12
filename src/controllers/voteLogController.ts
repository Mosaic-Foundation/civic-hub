// Vote log controller — public vote audit log and receipt verification.
//
// Privacy rules:
//   - Vote log is ONLY visible after the vote is closed or finalized
//   - No timestamps exposed publicly
//   - Log is shuffled (no ordering inference)
//   - Receipt lookup is exact match only
//   - A receipt never travels in a URL: verification is a POST with the
//     receipt in the body, so no request log pairs it with an address
//     (2026-10-10)

import { NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { claimVoteKey, getVoteLog, verifyReceipt } from "../modules/civic.receipts/index.js";
import { getProcess } from "../services/processService.js";
import { getAuthUser } from "../middleware/auth.js";

/**
 * GET /votes/:id/log
 * Returns the public vote log for a process.
 * Only available after voting is closed or finalized.
 */
export const handleGetVoteLog = route(async (req, res) => {
  const id = req.params.id as string;

  const process = await getProcess(id);
  if (!process) {
    throw new NotFoundError("Process not found");
  }

  if (process.definition.type !== "civic.vote") {
    throw new ValidationError("Not a vote process");
  }

  // Vote log is only visible after vote is closed
  const status = process.status;
  if (status !== "closed" && status !== "finalized") {
    res.json({
      process_id: id,
      status,
      available: false,
      message: "Vote log will be available after voting ends",
      log: [],
    });
    return;
  }

  const log = await getVoteLog(id);

  res.json({
    process_id: id,
    status,
    available: true,
    total_votes: log.length,
    log,
  });
});

/**
 * POST /votes/:id/verify  { receipt: <receipt_id> }
 * Verify a specific receipt against a process.
 * Exact match only — no partial or fuzzy matching.
 */
export const handleVerifyReceipt = route(async (req, res) => {
  const id = req.params.id as string;
  const receiptId = typeof req.body?.receipt === "string" ? req.body.receipt.trim() : "";

  if (!receiptId || receiptId.length > 100) {
    throw new ValidationError("receipt is required");
  }

  const process = await getProcess(id);
  if (!process) {
    throw new NotFoundError("Process not found");
  }

  if (process.definition.type !== "civic.vote") {
    throw new ValidationError("Not a vote process");
  }

  // Verification only available after vote is closed
  const status = process.status;
  if (status !== "closed" && status !== "finalized") {
    res.json({
      found: false,
      message: "Receipt verification will be available after voting ends",
    });
    return;
  }

  const result = await verifyReceipt(receiptId, id);

  if (result) {
    res.json({
      found: true,
      receipt_id: result.receipt_id,
      choice: result.choice,
    });
  } else {
    res.json({
      found: false,
      message: "Receipt not found. Check your receipt and try again.",
    });
  }
});

/**
 * POST /votes/:id/claim-receipt
 * For a resident who voted before 2026-10-10 on a vote that is still open:
 * their browser gets the receipt and a change key, once, and the server
 * deletes the row that linked them to it. 404 when there is nothing to hand
 * out — they voted after the change (their receipt is on the browser they
 * voted from), already collected it, or the vote is not open.
 */
export const handleClaimReceipt = route(async (req, res) => {
  const id = req.params.id as string;
  const user = getAuthUser(res);
  const process = await getProcess(id);
  if (!process || process.definition.type !== "civic.vote" || process.status !== "active") {
    throw new NotFoundError("Nothing to collect", "no_receipt_to_claim");
  }
  const claimed = await claimVoteKey(id, user.id);
  if (!claimed) {
    throw new NotFoundError("Nothing to collect", "no_receipt_to_claim");
  }
  res.json(claimed);
});
