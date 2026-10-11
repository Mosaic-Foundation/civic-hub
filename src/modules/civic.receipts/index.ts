// civic.receipts module — anonymous vote receipt service
//
// Data layout (2026-10-10, ballot secrecy against the raw data):
//   vote_records       — receipt_id → { process_id, choice, change_key_hash }
//                        NO user_id, NO time (created_at is always NULL), and
//                        no order: reshuffle_ballots rewrites a process's
//                        ballots in random order at close and hourly.
//   vote_participation — (user_id, process_id) → has_voted
//                        NO receipt_id. EVER.
//   active_vote_keys   — RETIRED. Nothing writes it. claimVoteKey drains the
//                        rows left from before 2026-10-10; close clears the
//                        rest. A later migration drops it.
//
// Trust model: the VOTER holds the receipt. A first vote returns the receipt
// and a random change key, once; the ballot stores only sha256(change key).
// To change a vote, the voter's browser presents both. The server never holds
// a row, a log line or a URL that pairs a person with a receipt, so nobody
// with the database, a backup, an export or the logs can tell how someone
// voted. A voter who has lost the receipt (new device, cleared browser)
// cannot change their vote; it still counts.
//
// GUARDRAIL: vote_records and vote_participation MUST NOT acquire a shared
// join key, a shared time, or a shared order. tests/api/ballotSecrecy.test.ts
// and tests/api/ballotSecrecyCatalog.test.ts fail if one comes back.
//
// Per hub since Phase 2a: all tables carry hub_id and every query here goes
// through forHub(). hub_id is NOT a join key in the sense of the guardrail:
// both tables already carry process_id, and a process belongs to one hub.

import { forHub, type HubDb } from "../../db/forHub.js";
import { createHash, randomBytes } from "node:crypto";
import {
  AlreadyVotedError,
  ReceiptNotAcceptedError,
  ReceiptWithoutVoteError,
  ballotByReceipt,
  castBallot,
  claimVoteKey as claimVoteKeyRpc,
  reshuffleBallots,
} from "../../db/atomic.js";
import type { CivicEvent } from "../../models/event.js";
import { currentHubId } from "../../config/hubContext.js";
import { readAll } from "../../db/readAll.js";

/** The hub in scope. Votes are only ever cast, read or cleared inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

// --- Public API ------------------------------------------------------------

/** A receipt as the voter's browser holds it. */
export interface HeldReceipt {
  receipt_id: string;
  change_key: string;
}

/** sha256 hex of a change key: what a ballot stores, and what a change presents. */
export function hashChangeKey(changeKey: string): string {
  return createHash("sha256").update(changeKey, "utf8").digest("hex");
}

function newChangeKey(): string {
  return randomBytes(32).toString("base64url");
}

/** The refusals a voter can act on, by code (the UI keys its message on it). */
export type VoteRefusal = "already_voted" | "receipt_not_accepted" | "receipt_without_vote";

export class VoteRefusedError extends Error {
  constructor(
    readonly code: VoteRefusal,
    message: string,
  ) {
    super(message);
    this.name = "VoteRefusedError";
  }
}

/**
 * Cast a vote, or change one with the receipt the voter holds — and write
 * the vote_submitted event, when given, in the same transaction
 * (cast_ballot). A first vote returns the receipt and its change key; the
 * key is shown once and only its hash is stored. A change returns the same
 * receipt, with `unchanged` when the choice was already the ballot's.
 * Any failure writes nothing.
 */
export async function recordOrUpdateVote(
  processId: string,
  userId: string,
  choice: string,
  event: CivicEvent | null = null,
  held: HeldReceipt | null = null,
): Promise<{ receipt_id: string; change_key: string | null; updated: boolean; unchanged: boolean }> {
  const changeKey = held ? null : newChangeKey();
  try {
    const out = await castBallot({
      hubId: currentHubId(),
      processId,
      userId,
      choice,
      event,
      held: held ? { receipt_id: held.receipt_id, key_hash: hashChangeKey(held.change_key) } : null,
      // cast_ballot needs a hash even on a change, where it is unused.
      newKeyHash: hashChangeKey(changeKey ?? newChangeKey()),
    });
    return { ...out, change_key: changeKey };
  } catch (err) {
    if (
      err instanceof AlreadyVotedError ||
      err instanceof ReceiptNotAcceptedError ||
      err instanceof ReceiptWithoutVoteError
    ) {
      throw new VoteRefusedError(err.code, err.message);
    }
    throw new Error(`Receipts: ${(err as Error).message}`);
  }
}

/**
 * For a voter whose ballot was cast before 2026-10-10 on a vote still open:
 * a change key for their receipt, handed to their browser once, and their
 * bridge row deleted. null when there is nothing to hand out (they voted
 * after the change, on another browser, or the vote has closed).
 */
export async function claimVoteKey(
  processId: string,
  userId: string,
): Promise<{ receipt_id: string; change_key: string; choice: string } | null> {
  const changeKey = newChangeKey();
  const out = await claimVoteKeyRpc(currentHubId(), processId, userId, hashChangeKey(changeKey));
  return out ? { receipt_id: out.receipt_id, change_key: changeKey, choice: String(out.choice) } : null;
}

/**
 * Rewrite one process's ballots in random order: no insertion order, one
 * shared transaction id. Called at close and by the hourly vote_close job.
 */
export async function reshuffleBallotsForProcess(processId: string): Promise<number> {
  return reshuffleBallots(currentHubId(), processId);
}

/**
 * Reshuffle the ballots of every vote on this hub that is open, or changed
 * status in the last two hours (a close whose own reshuffle failed). Run by
 * the hourly vote_close job at :05, ~12 minutes before each backup.
 */
export async function reshuffleOpenBallots(now: Date = new Date()): Promise<{ processes: number; ballots: number }> {
  const since = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const rows = await readAll((from, to) =>
    db()
      .from("processes")
      .select<{ id: string }>("id")
      .eq("type", "civic.vote")
      .or(`status.eq.active,updated_at.gte.${since}`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  let ballots = 0;
  for (const r of rows) ballots += await reshuffleBallotsForProcess(r.id);
  return { processes: rows.length, ballots };
}

/**
 * All anonymized ballot choices for a process — the tally source.
 * vote_records carries no user linkage, so this is safe to read on
 * any results path.
 */
export async function getBallotChoicesForProcess(
  processId: string,
): Promise<string[]> {
  // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
  const rows = await readAll((from, to) =>
    db()
      .from("vote_records")
      .select<{ choice: string }>("choice")
      .eq("process_id", processId)
      .order("receipt_id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => String(r.choice));
}

/**
 * Drop every active_vote_key row left for a process (early voters who never
 * collected their key). Called on close, as before 2026-10-10.
 */
export async function clearActiveVoteKeysForProcess(
  processId: string,
): Promise<void> {
  await db().from("active_vote_keys").delete().eq("process_id", processId);
}

/**
 * Look up a single receipt by exact ID, through ballot_by_receipt so the
 * receipt travels in a call body, never in a logged URL.
 * Returns { receipt_id, choice } if found, null if not.
 */
export async function verifyReceipt(
  receiptId: string,
  processId: string,
): Promise<{ receipt_id: string; choice: string } | null> {
  // A failed lookup verifies nothing, as before: null, never a 500.
  try {
    const row = await ballotByReceipt(currentHubId(), processId, receiptId);
    return row ? { receipt_id: row.receipt_id, choice: String(row.choice) } : null;
  } catch {
    return null;
  }
}

/**
 * Get the public vote log for a process.
 * Returns receipt_id and choice ONLY — no timestamps, no order.
 * List is shuffled to prevent ordering-based inference.
 */
export async function getVoteLog(
  processId: string,
): Promise<{ receipt_id: string; choice: string }[]> {
  // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
  const rows = await readAll((from, to) =>
    db()
      .from("vote_records")
      .select<{ receipt_id: string; choice: string }>("receipt_id, choice")
      .eq("process_id", processId)
      .order("receipt_id", { ascending: true })
      .range(from, to),
  );

  const log = rows.map((r) => ({
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
  const count = await db()
    .from("vote_participation")
    .count()
    .eq("user_id", userId)
    .eq("process_id", processId);
  return count > 0;
}

/** Clear this hub's receipt data — dev/test reset only. */
export async function clearReceipts(): Promise<void> {
  const hubDb = db();
  await hubDb.from("vote_records").delete().neq("receipt_id", "");
  await hubDb.from("vote_participation").delete().neq("user_id", "");
  await hubDb.from("active_vote_keys").delete().neq("user_id", "");
}
