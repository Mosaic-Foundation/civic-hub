// ballots: secret ballots with receipts, as a package casts and reads them
// (kernel step 1, docs/kernel/SURFACE.md, "Ballots"). The kernel keeps every
// ballot (src/modules/civic.receipts/: vote_records and vote_participation,
// the secrecy rules in its header, the district and age tags the kernel's
// breakdowns total, the hourly reshuffle). A type that takes ballots casts,
// counts and checks them here, on its own processes, and never sees who cast
// which: the voter holds the receipt.
//
// Every call takes the process first.

import {
  countVoters,
  getBallotChoicesForProcess,
  getVoteLog,
  hasUserVoted,
  recordOrUpdateVote,
  reshuffleBallotsForProcess,
  verifyReceipt,
  type HeldReceipt,
} from "../modules/civic.receipts/index.js";
import type { CivicEvent } from "../models/event.js";

export const ballots = {
  /**
   * Cast this person's ballot (`choice`, as the type serializes it), or change
   * it under the receipt their browser holds. `event` is written in the same
   * transaction as the ballot (build it with buildEvent). A first ballot
   * returns the receipt and a change key, once.
   */
  cast: (processId: string, actorId: string, choice: string, event: CivicEvent | null = null, held: HeldReceipt | null = null) =>
    recordOrUpdateVote(processId, actorId, choice, event, held),
  /** Whether this person has cast a ballot on the process (never which). */
  hasVoted: (processId: string, actorId: string): Promise<boolean> => hasUserVoted(actorId, processId),
  /** How many people have voted. */
  count: (processId: string): Promise<number> => countVoters(processId),
  /** Every ballot's choice, in no order that lines one up with a voter. */
  choices: (processId: string): Promise<string[]> => getBallotChoicesForProcess(processId),
  /** Rewrite the ballots in random order (after a close; the kernel also does it hourly). */
  reshuffle: (processId: string): Promise<number> => reshuffleBallotsForProcess(processId),
  /** The public log: each receipt and its choice. */
  log: (processId: string) => getVoteLog(processId),
  /** One receipt's ballot, exact match only, or null. */
  verify: (processId: string, receiptId: string) => verifyReceipt(receiptId, processId),
};

export type { HeldReceipt };
