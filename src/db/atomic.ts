// The two atomic database functions (20260924080000), called through
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

/** A refused vote change: the pre-existing "already voted" rule. */
export class AlreadyVotedError extends Error {
  constructor() {
    super("You have already voted on this process");
    this.name = "AlreadyVotedError";
  }
}

function logged(event: CivicEvent | null): void {
  if (event) console.log(`[event] ${event.event_type} by ${event.actor} (${event.id})`);
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
 * Cast or change one ballot: participation, ballot, receipt bridge and the
 * vote_submitted event, in one transaction. The ballot-secrecy layout is the
 * function's; this passes the voter, the serialized choice and the event.
 */
export async function castVote(input: {
  hubId: string;
  processId: string;
  userId: string;
  choice: string;
  event: CivicEvent | null;
}): Promise<{ receipt_id: string; updated: boolean }> {
  try {
    const out = await forHub(input.hubId).rpc<{ receipt_id: string; updated: boolean }>("cast_vote", {
      p_process_id: input.processId,
      p_user_id: input.userId,
      p_choice: input.choice,
      p_event: input.event ? eventToRow(input.event) : null,
    });
    logged(input.event);
    return out;
  } catch (err) {
    if (err instanceof HubDbError && err.code === "P0001" && /already_voted/.test(err.message)) {
      throw new AlreadyVotedError();
    }
    throw err;
  }
}
