// civic.input's store (src/modules/civic.input/store.ts): the
// `community_inputs` table, on the hub in scope.

import { forHub, type HubDb } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { InputRow, InputStore } from "../modules/civic.input/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const inputStoreImpl: InputStore = {
  async insertInput(row) {
    return await db().from("community_inputs").insert(row).select<InputRow>().single();
  },

  async inputsForProcess(processId) {
    // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
    return readAll((from, to) =>
      db()
        .from("community_inputs")
        .select<InputRow>("*")
        .eq("process_id", processId)
        .order("submitted_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  },

  async findInput(id) {
    return await db().from("community_inputs").select<InputRow>("*").eq("id", id).maybeSingle();
  },

  async markHidden(id, hide) {
    return await db()
      .from("community_inputs")
      .update({
        hidden_at: hide.hiddenAt,
        hidden_by: hide.hiddenBy,
        hidden_reason: hide.reason,
        restored_at: null,
      })
      .eq("id", id)
      .select<InputRow>()
      .single();
  },

  async markRestored(id, restoredAt) {
    return await db()
      .from("community_inputs")
      .update({ restored_at: restoredAt })
      .eq("id", id)
      .select<InputRow>()
      .single();
  },

  async deleteAll() {
    await db().from("community_inputs").delete().neq("id", "");
  },
};
