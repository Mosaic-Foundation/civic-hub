// civic.receipts module — anonymous vote receipt service
//
// Data layout:
//   vote_records       — receipt_id → { process_id, choice, created_at }
//                        NO user_id. EVER.
//   vote_participation — (user_id, process_id) → has_voted
//                        NO receipt_id. EVER.
//   active_vote_keys   — (user_id, process_id) → receipt_id
//                        TRANSIENT. Populated only while a vote is active;
//                        cleared row-by-row on closeVote so the post-close
//                        snapshot retains the strict vote_records ↔
//                        vote_participation separation.
//
// Trust model:
//   While a vote is open, active_vote_keys lets the server map a
//   re-voting user back to their existing receipt so vote-changing is
//   possible. Once the vote closes, those keys are deleted and no
//   persisted row links user_id ↔ receipt_id ↔ choice. This matches the
//   paper-ballot mental model: ballots can be changed before the box
//   closes; once closed, only counted ballots remain.
//
// GUARDRAIL: vote_records and vote_participation MUST NOT acquire a
// shared join key. active_vote_keys is the ONLY bridge, and only during
// the active window.
//
// Per hub since Phase 2a: all three tables carry hub_id and every query here
// goes through forHub(), so a receipt, a ballot or a participation row is
// read, written or cleared only on the hub whose vote it belongs to. hub_id
// is NOT a join key in the sense of the guardrail above: both tables already
// carry process_id, and a process belongs to exactly one hub, so hub_id adds
// nothing that links a voter to a ballot. The ballot-secrecy layout from the
// July audit is unchanged; only its scope is.

import crypto from "crypto";
import { forHub, type HubDb } from "../../db/forHub.js";
import { currentHubId } from "../../config/hubContext.js";
import type { VoteRecord, UserParticipation } from "./models.js";

/** The hub in scope. Votes are only ever cast, read or cleared inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

// --- Receipt generation ----------------------------------------------------

function generateReceiptId(): string {
  return crypto.randomUUID();
}

// --- Public API ------------------------------------------------------------

/**
 * Record a new vote OR update an existing one, returning the user's
 * (stable) receipt for this process.
 *
 * Branches:
 *   First-time vote:
 *     1. Insert participation (PK = user_id+process_id) — atomic dup
 *        guard.
 *     2. Insert vote_record with fresh UUID receipt — no user_id.
 *     3. Insert active_vote_keys row mapping user → receipt for the
 *        active window.
 *     If step 2 or 3 fails, best-effort roll back step 1 (and 2) so the
 *     user can retry without losing their slot.
 *
 *   Re-vote (participation insert hits 23505):
 *     1. Look up the existing receipt via active_vote_keys.
 *     2. UPDATE vote_records.choice — receipt_id stays stable so any
 *        previously-shown receipt still verifies to the user's current
 *        choice.
 *     If active_vote_keys has no row (closed vote, or closed-and-
 *     reopened legacy data), surface the original "already voted"
 *     error rather than silently failing.
 */
export async function recordOrUpdateVote(
  processId: string,
  userId: string,
  choice: string,
): Promise<{ receipt_id: string; updated: boolean }> {
  const hubDb = db();

  // Try to reserve participation. PK collision = re-vote path.
  const { error: partErr } = await hubDb.from("vote_participation").insert({
    user_id: userId,
    process_id: processId,
    has_voted: true,
  });

  if (partErr) {
    if (partErr.code === "23505") {
      // Re-vote: look up the user's existing receipt and update its choice.
      const { data: keyRow, error: keyErr } = await hubDb
        .from("active_vote_keys")
        .select("receipt_id")
        .eq("user_id", userId)
        .eq("process_id", processId)
        .maybeSingle();

      if (keyErr) throw new Error(`Receipts: ${keyErr.message}`);
      if (!keyRow) {
        // No active key — either the vote closed, or this user voted
        // before active_vote_keys existed. Either way, refuse the change.
        throw new Error("You have already voted on this process");
      }

      const { error: updateErr } = await hubDb
        .from("vote_records")
        .update({ choice })
        .eq("receipt_id", keyRow.receipt_id);

      if (updateErr) throw new Error(`Receipts: ${updateErr.message}`);

      return { receipt_id: keyRow.receipt_id, updated: true };
    }
    throw new Error(`Receipts: ${partErr.message}`);
  }

  // First-time vote.
  const receipt_id = generateReceiptId();

  const { error: voteErr } = await hubDb.from("vote_records").insert({
    receipt_id,
    process_id: processId,
    choice,
  });

  if (voteErr) {
    await hubDb
      .from("vote_participation")
      .delete()
      .eq("user_id", userId)
      .eq("process_id", processId);
    throw new Error(`Receipts: ${voteErr.message}`);
  }

  const { error: keyInsertErr } = await hubDb.from("active_vote_keys").insert({
    user_id: userId,
    process_id: processId,
    receipt_id,
  });

  if (keyInsertErr) {
    // Roll back both prior writes so the user can retry cleanly.
    await hubDb.from("vote_records").delete().eq("receipt_id", receipt_id);
    await hubDb
      .from("vote_participation")
      .delete()
      .eq("user_id", userId)
      .eq("process_id", processId);
    throw new Error(`Receipts: ${keyInsertErr.message}`);
  }

  return { receipt_id, updated: false };
}

/**
 * Look up the caller's CURRENT ballot choice via the transient
 * active_vote_keys bridge. Only meaningful while the vote is open —
 * after closeVote the keys are gone and this returns null, which is
 * exactly the paper-ballot semantics (nobody, including the voter,
 * can look a cast ballot back up by identity once the box closes).
 */
export async function getActiveChoice(
  userId: string,
  processId: string,
): Promise<string | null> {
  const hubDb = db();
  const { data: keyRow, error: keyErr } = await hubDb
    .from("active_vote_keys")
    .select("receipt_id")
    .eq("user_id", userId)
    .eq("process_id", processId)
    .maybeSingle();
  if (keyErr) throw new Error(`Receipts: ${keyErr.message}`);
  if (!keyRow) return null;

  const { data: record, error: recErr } = await hubDb
    .from("vote_records")
    .select("choice")
    .eq("receipt_id", keyRow.receipt_id)
    .maybeSingle();
  if (recErr) throw new Error(`Receipts: ${recErr.message}`);
  return record ? String(record.choice) : null;
}

/**
 * All anonymized ballot choices for a process — the tally source.
 * vote_records carries no user linkage, so this is safe to read on
 * any results path.
 */
export async function getBallotChoicesForProcess(
  processId: string,
): Promise<string[]> {
  const { data, error } = await db()
    .from("vote_records")
    .select("choice")
    .eq("process_id", processId);
  if (error) throw new Error(`Receipts: ${error.message}`);
  return (data ?? []).map((r) => String(r.choice));
}

/**
 * Drop every active_vote_key row for a process. Called by the vote
 * lifecycle on closeVote so the post-close snapshot retains no
 * user_id ↔ receipt_id linkage.
 */
export async function clearActiveVoteKeysForProcess(
  processId: string,
): Promise<void> {
  const { error } = await db()
    .from("active_vote_keys")
    .delete()
    .eq("process_id", processId);
  if (error) throw new Error(`Receipts: ${error.message}`);
}

/**
 * Look up a single receipt by exact ID.
 * Returns { receipt_id, choice } if found, null if not.
 * Does NOT return timestamps or any identifying info.
 */
export async function verifyReceipt(
  receiptId: string,
  processId: string,
): Promise<{ receipt_id: string; choice: string } | null> {
  const { data, error } = await db()
    .from("vote_records")
    .select("receipt_id, choice, process_id")
    .eq("receipt_id", receiptId)
    .maybeSingle();

  if (error || !data || data.process_id !== processId) return null;

  return {
    receipt_id: data.receipt_id,
    choice: data.choice,
  };
}

/**
 * Get the public vote log for a process.
 * Returns receipt_id and choice ONLY — no timestamps, no order.
 * List is shuffled to prevent ordering-based inference.
 */
export async function getVoteLog(
  processId: string,
): Promise<{ receipt_id: string; choice: string }[]> {
  const { data, error } = await db()
    .from("vote_records")
    .select("receipt_id, choice")
    .eq("process_id", processId);

  if (error) throw new Error(`Receipts: ${error.message}`);

  const log = (data ?? []).map((r) => ({
    receipt_id: r.receipt_id,
    choice: r.choice,
  }));

  // Fisher-Yates shuffle to prevent ordering-based inference.
  for (let i = log.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [log[i], log[j]] = [log[j], log[i]];
  }

  return log;
}

/**
 * Check if a user has already voted on a process.
 * Uses vote_participation only — never touches vote_records.
 */
export async function hasUserVoted(
  userId: string,
  processId: string,
): Promise<boolean> {
  const { count, error } = await db()
    .from("vote_participation")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("process_id", processId);
  if (error) throw new Error(`Receipts: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Clear this hub's receipt data — dev/test reset only. */
export async function clearReceipts(): Promise<void> {
  const hubDb = db();
  const a = await hubDb.from("vote_records").delete().neq("receipt_id", "");
  if (a.error) throw new Error(`Receipts: ${a.error.message}`);
  const b = await hubDb.from("vote_participation").delete().neq("user_id", "");
  if (b.error) throw new Error(`Receipts: ${b.error.message}`);
  const c = await hubDb.from("active_vote_keys").delete().neq("user_id", "");
  if (c.error) throw new Error(`Receipts: ${c.error.message}`);
}
