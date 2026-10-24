// civic.receipts' store (src/modules/civic.receipts/store.ts): the
// `vote_records`, `vote_participation` and `active_vote_keys` tables and the
// ballot functions, on the hub in scope. The same calls the module made, moved
// here unchanged; the secrecy rules in the module's header apply to this file
// too (vote_records and vote_participation share no key, time or order).

import { forHub, type HubDb } from "../db/forHub.js";
import { ballotByReceipt, castBallot, claimVoteKey, reshuffleBallots } from "../db/atomic.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { ReceiptsStore } from "../modules/civic.receipts/store.js";

/** The hub in scope. Votes are only ever cast, read or cleared inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

export const receiptsStoreImpl: ReceiptsStore = {
  async castBallot(input) {
    return castBallot(input);
  },

  async reshuffleBallots(hubId, processId) {
    return reshuffleBallots(hubId, processId);
  },

  async claimVoteKey(hubId, processId, userId, keyHash) {
    return claimVoteKey(hubId, processId, userId, keyHash);
  },

  async ballotByReceipt(hubId, processId, receiptId) {
    return ballotByReceipt(hubId, processId, receiptId);
  },

  async ballotChoices(processId) {
    // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
    return readAll((from, to) =>
      db()
        .from("vote_records")
        .select<{ choice: string }>("choice")
        .eq("process_id", processId)
        .order("receipt_id", { ascending: true })
        .range(from, to),
    );
  },

  async ballotLog(processId) {
    // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
    return readAll((from, to) =>
      db()
        .from("vote_records")
        .select<{ receipt_id: string; choice: string }>("receipt_id, choice")
        .eq("process_id", processId)
        .order("receipt_id", { ascending: true })
        .range(from, to),
    );
  },

  async clearActiveVoteKeys(processId) {
    await db().from("active_vote_keys").delete().eq("process_id", processId);
  },

  async drainActiveVoteKeys(processId) {
    const cleared = await db().from("active_vote_keys").delete().eq("process_id", processId).select<{ process_id: string }>("process_id");
    return cleared.length;
  },

  async countParticipation(userId, processId) {
    return db().from("vote_participation").count().eq("user_id", userId).eq("process_id", processId);
  },

  async countVoted(processId) {
    return db().from("vote_participation").count().eq("process_id", processId).eq("has_voted", true);
  },

  async clearAll() {
    const hubDb = db();
    await hubDb.from("vote_records").delete().neq("receipt_id", "");
    await hubDb.from("vote_participation").delete().neq("user_id", "");
    await hubDb.from("active_vote_keys").delete().neq("user_id", "");
  },
};
