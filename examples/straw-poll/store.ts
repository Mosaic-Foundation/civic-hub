// What the straw poll keeps: one answer per resident per poll, in its own
// table, on the database its host hands it (its granted tables only).

import { HubDbError, readAll, storeSlot, type GrantedDb } from "@civic-social/plugin-sdk";

export interface StrawPollStore {
  /** Record an answer. "duplicate": this resident already answered (the unique index). */
  insertAnswer(row: { process_id: string; user_id: string; choice: string }): Promise<"ok" | "duplicate">;
  /** Whether this resident has answered. */
  hasAnswered(processId: string, userId: string): Promise<boolean>;
  /** Each option's count. */
  counts(processId: string): Promise<Record<string, number>>;
}

export const strawPollStore = storeSlot<StrawPollStore>("example.straw_poll");

export function createStrawPollStore(db: () => GrantedDb): StrawPollStore {
  return {
    async insertAnswer(row) {
      try {
        await db().from("straw_poll_answers").insert(row);
        return "ok";
      } catch (err) {
        if (err instanceof HubDbError && err.code === "23505") return "duplicate";
        throw err;
      }
    },

    async hasAnswered(processId, userId) {
      return (await db().from("straw_poll_answers").count().eq("process_id", processId).eq("user_id", userId)) > 0;
    },

    async counts(processId) {
      const rows = await readAll((from, to) =>
        db()
          .from("straw_poll_answers")
          .select<{ choice: string }>("choice")
          .eq("process_id", processId)
          .order("user_id", { ascending: true })
          .range(from, to),
      );
      const out: Record<string, number> = {};
      for (const r of rows) out[r.choice] = (out[r.choice] ?? 0) + 1;
      return out;
    },
  };
}
