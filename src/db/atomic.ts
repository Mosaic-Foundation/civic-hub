// The atomic database functions (20260924080000, 20261010000000), called through
// forHub().rpc(), which adds p_hub_id. Each does its writes in one
// transaction and checks that every row it touches is on the hub; see the
// migration for what they write and why.
//
// Callers build the event with buildEvent() (src/events/eventEmitter.ts), so
// it is exactly the event emitEvent would have stored, and pass it here
// instead of emitting it: the function writes it with the state change, or
// neither.

import { forHub, HubDbError } from "./forHub.js";
import { eventToRow } from "../events/eventStore.js";
import type { CivicEvent } from "../models/event.js";

/**
 * A second vote with no receipt and change key: the voter has voted, and
 * only the browser holding their receipt can change it. The server keeps
 * nothing that would let it find their ballot (2026-10-10).
 */
export class AlreadyVotedError extends Error {
  readonly code = "already_voted";
  constructor() {
    super(
      "You've already voted, and your vote is counted. You can change it only from the browser where you voted, " +
        "because we don't keep any record that links you to your ballot.",
    );
    this.name = "AlreadyVotedError";
  }
}

/** A change whose receipt and key do not match a ballot of this vote. */
export class ReceiptNotAcceptedError extends Error {
  readonly code = "receipt_not_accepted";
  constructor() {
    super("That receipt can't change a vote here. Your vote is still counted.");
    this.name = "ReceiptNotAcceptedError";
  }
}

/** A receipt presented by someone who has not voted on this vote. */
export class ReceiptWithoutVoteError extends Error {
  readonly code = "receipt_without_vote";
  constructor() {
    super("That receipt isn't from your vote. Vote without it.");
    this.name = "ReceiptWithoutVoteError";
  }
}

function logged(event: CivicEvent | null): void {
  if (!event) return;
  // A vote's log line names no voter: with the time on it, it would place
  // that person beside whatever else was logged in the same second.
  const by = event.event_type === "civic.process.vote_submitted" ? "a voter" : event.actor;
  console.log(`[event] ${event.event_type} by ${by} (${event.id})`);
}

/**
 * Change a process's status — and its state, when given — and write the
 * event recording it, in one transaction.
 */
export async function transitionProcess(input: {
  hubId: string;
  processId: string;
  toStatus: string;
  actor: string;
  event: CivicEvent | null;
  state?: Record<string, unknown>;
}): Promise<{ previous_status: string; status: string; updated_at: string }> {
  const out = await forHub(input.hubId).rpc<{ previous_status: string; status: string; updated_at: string }>(
    "transition_process",
    {
      p_process_id: input.processId,
      p_to_status: input.toStatus,
      p_actor: input.actor,
      p_event: input.event ? eventToRow(input.event) : null,
      p_state: input.state ?? null,
    },
  );
  logged(input.event);
  return out;
}

/**
 * Cast or change one ballot: participation, ballot and the vote_submitted
 * event, in one transaction (cast_ballot, 20261010000000). A first vote
 * stores the hash of a new change key; a change presents the receipt and the
 * hash of the key the voter's browser holds. No row links voter and receipt.
 */
export async function castBallot(input: {
  hubId: string;
  processId: string;
  userId: string;
  choice: string;
  event: CivicEvent | null;
  /** A change: the receipt and the sha256 of its change key. */
  held: { receipt_id: string; key_hash: string } | null;
  /** A first vote: the sha256 of the new change key. */
  newKeyHash: string;
}): Promise<{ receipt_id: string; updated: boolean; unchanged: boolean }> {
  try {
    const out = await forHub(input.hubId).rpc<{ receipt_id: string; updated: boolean; unchanged: boolean }>(
      "cast_ballot",
      {
        p_process_id: input.processId,
        p_user_id: input.userId,
        p_choice: input.choice,
        p_event: input.event ? eventToRow(input.event) : null,
        p_receipt: input.held?.receipt_id ?? null,
        p_key_hash: input.held?.key_hash ?? null,
        p_new_key_hash: input.newKeyHash,
      },
    );
    if (!out.unchanged) logged(input.event);
    return out;
  } catch (err) {
    if (err instanceof HubDbError && err.code === "P0001") {
      if (/already_voted/.test(err.message)) throw new AlreadyVotedError();
      if (/receipt_not_accepted/.test(err.message)) throw new ReceiptNotAcceptedError();
      if (/receipt_without_vote/.test(err.message)) throw new ReceiptWithoutVoteError();
    }
    throw err;
  }
}

/**
 * Rewrite one process's ballots in random order (reshuffle_ballots): one
 * shared transaction id, no insertion order. Returns the ballots rewritten.
 */
export async function reshuffleBallots(hubId: string, processId: string): Promise<number> {
  return forHub(hubId).rpc<number>("reshuffle_ballots", { p_process_id: processId });
}

/**
 * An early voter (ballot from before 2026-10-10, vote still open) collects a
 * change key for their receipt; their bridge row is deleted. null when they
 * have none.
 */
export async function claimVoteKey(
  hubId: string,
  processId: string,
  userId: string,
  keyHash: string,
): Promise<{ receipt_id: string; choice: string } | null> {
  return forHub(hubId).rpc<{ receipt_id: string; choice: string } | null>("claim_vote_key", {
    p_process_id: processId,
    p_user_id: userId,
    p_key_hash: keyHash,
  });
}

/** A ballot by its receipt, the receipt in the call body (ballot_by_receipt). */
export async function ballotByReceipt(
  hubId: string,
  processId: string,
  receiptId: string,
): Promise<{ receipt_id: string; choice: string } | null> {
  return forHub(hubId).rpc<{ receipt_id: string; choice: string } | null>("ballot_by_receipt", {
    p_process_id: processId,
    p_receipt: receiptId,
  });
}
