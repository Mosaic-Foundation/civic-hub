// What civic.receipts keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/receipts.ts, bound at startup by installStores(). It holds
// exactly the calls the module made before: the ballot secrecy rules in the
// module's header (and tests/api/ballotSecrecy*.test.ts) govern what may
// be added here. The module's reads of the `processes` table are
// src/services/processRows.ts.

import { storeSlot } from "../../processes/storeSlot.js";
import type { ballotByReceipt, castBallot, claimVoteKey, reshuffleBallots } from "../../db/atomic.js";

export interface ReceiptsStore {
  /** Cast or change one ballot, with its event, in one transaction (cast_ballot). */
  castBallot(input: Parameters<typeof castBallot>[0]): ReturnType<typeof castBallot>;
  /** Rewrite one process's ballots in random order (reshuffle_ballots). */
  reshuffleBallots(hubId: string, processId: string): ReturnType<typeof reshuffleBallots>;
  /** An early voter collects a change key for their receipt (claim_vote_key). */
  claimVoteKey(hubId: string, processId: string, userId: string, keyHash: string): ReturnType<typeof claimVoteKey>;
  /** A ballot by its receipt, the receipt in the call body (ballot_by_receipt). */
  ballotByReceipt(hubId: string, processId: string, receiptId: string): ReturnType<typeof ballotByReceipt>;
  /** Every ballot's choice on a process, in receipt order (paged past 1,000). */
  ballotChoices(processId: string): Promise<Array<{ choice: string }>>;
  /** Every ballot's receipt and choice on a process, in receipt order (paged past 1,000). */
  ballotLog(processId: string): Promise<Array<{ receipt_id: string; choice: string }>>;
  /** Delete the retired bridge rows left for a process. */
  clearActiveVoteKeys(processId: string): Promise<void>;
  /** Delete the retired bridge rows left for a process and return how many there were. */
  drainActiveVoteKeys(processId: string): Promise<number>;
  /** How many participation rows this user has on this process (0 or 1). */
  countParticipation(userId: string, processId: string): Promise<number>;
  /** How many people have voted on a process. */
  countVoted(processId: string): Promise<number>;
  /** Development and tests only: clear this hub's receipt data. */
  clearAll(): Promise<void>;
}

export const receiptsStore = storeSlot<ReceiptsStore>("civic.receipts");
