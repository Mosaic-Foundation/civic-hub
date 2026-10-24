// civic.drafts' store (src/modules/civic.drafts/store.ts): each kind's drafts
// table, named by its spec, on the hub in scope, so a draft is only ever seen
// inside its hub (ADR-012).

import { forHub, type HubDb } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import type { DraftRow, DraftsStore } from "../modules/civic.drafts/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const draftsStoreImpl: DraftsStore = {
  async insertDraft(table, row) {
    return await db().from(table).insert(row).select<DraftRow>().single();
  },

  async findDraft(table, id) {
    return await db().from(table).select<DraftRow>("*").eq("id", id).maybeSingle();
  },

  async draftsOf(table, userId, status) {
    let q = db().from(table).select<DraftRow>("*").eq("user_id", userId).order("updated_at", { ascending: false });
    if (status) q = q.eq("status", status);
    return await q;
  },

  async updateDraft(table, id, updates) {
    return await db().from(table).update(updates).eq("id", id).select<DraftRow>().single();
  },

  async writeDraft(table, id, updates) {
    await db().from(table).update(updates).eq("id", id);
  },

  async claimDraft(table, id) {
    const rows = await db()
      .from(table)
      .update({ status: "submitted" })
      .eq("id", id)
      .eq("status", "drafting")
      .select<{ id: string }>("id");
    return rows.length > 0;
  },
};
