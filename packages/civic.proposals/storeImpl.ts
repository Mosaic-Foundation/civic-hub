// civic.proposals' store (./store.ts): the `proposals` and `proposal_supports`
// tables, on the hub in scope, through the database its host hands it (its
// granted tables only).

import { HubDbError, readAll, type GrantedDb } from "../../src/sdk/index.js";
import type { ProposalRow, ProposalsStore } from "./store.js";
import type { ProposalStatus } from "./models.js";

export function createProposalsStore(db: () => GrantedDb): ProposalsStore {
  return {
    async insertProposal(row) {
      return await db().from("proposals").insert(row).select<ProposalRow>().single();
    },

    async findProposal(id) {
      return await db().from("proposals").select<ProposalRow>("*").eq("id", id).maybeSingle();
    },

    async proposalExists(id) {
      const data = await db().from("proposals").select<{ id: string }>("id").eq("id", id).maybeSingle();
      return !!data;
    },

    async listProposals(status) {
      return readAll((from, to) => {
        let query = db()
          .from("proposals")
          .select<ProposalRow>("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true });

        if (status) {
          query = query.eq("status", status);
        } else {
          // Default-exclude archived. An unfiltered list is the PUBLIC list, and
          // an archived proposal must not appear on it.
          query = query.neq("status", "archived");
        }

        return query.range(from, to);
      });
    },

    async listEndorsed() {
      return readAll((from, to) =>
        db()
          .from("proposals")
          .select<ProposalRow>("*")
          .eq("status", "endorsed")
          .order("support_count", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      );
    },

    async insertSupport(proposalId, userId) {
      try {
        await db().from("proposal_supports").insert({
          proposal_id: proposalId,
          user_id: userId,
        });
      } catch (err) {
        // The composite primary key (proposal_id, user_id).
        if (err instanceof HubDbError && err.code === "23505") return "duplicate";
        throw err;
      }
      return "ok";
    },

    async deleteSupport(proposalId, userId) {
      const removed = await db()
        .from("proposal_supports")
        .delete()
        .eq("proposal_id", proposalId)
        .eq("user_id", userId)
        .select();
      return !(!removed || removed.length === 0);
    },

    async countSupports(proposalId, userId) {
      let q = db().from("proposal_supports").count().eq("proposal_id", proposalId);
      if (userId !== undefined) q = q.eq("user_id", userId);
      return await q;
    },

    async setSupportCount(proposalId, count) {
      return await db()
        .from("proposals")
        .update({
          support_count: count,
          updated_at: new Date().toISOString(),
        })
        .eq("id", proposalId)
        .select<ProposalRow>()
        .single();
    },

    async statusOf(proposalId) {
      const row = await db()
        .from("proposals")
        .select<{ status?: string }>("status")
        .eq("id", proposalId)
        .maybeSingle();
      return row?.status;
    },

    async setStatus(proposalId, status) {
      await db()
        .from("proposals")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", proposalId);
    },

    async closeIfSubmitted(proposalId) {
      await db()
        .from("proposals")
        .update({ status: "closed" as ProposalStatus, updated_at: new Date().toISOString() })
        .eq("id", proposalId)
        .eq("status", "submitted");
    },

    async deleteAll() {
      const hubDb = db();
      // Explicit delete of supports first (belt-and-suspenders; FK cascade would
      // handle it, but being explicit avoids any surprise if FK is modified).
      await hubDb.from("proposal_supports").delete().neq("proposal_id", "");
      await hubDb.from("proposals").delete().neq("id", "");
    },
  };
}
