// civic.about's store (src/modules/civic.about/store.ts): the `member_about`
// table, on the hub in scope.

import { forHub, type HubDb } from "../db/forHub.js";
import { inChunks } from "../db/inChunks.js";
import { currentHubId } from "../config/hubContext.js";
import type { AboutStore, MemberAboutRow } from "../modules/civic.about/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

const COLUMNS = "user_id, district_id, birth_year, race, declined, asked_at, updated_at";

export const aboutStoreImpl: AboutStore = {
  async get(userId) {
    return db().from("member_about").select<MemberAboutRow>(COLUMNS).eq("user_id", userId).maybeSingle();
  },

  async put(row) {
    await db()
      .from("member_about")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "hub_id,user_id" });
  },

  async forUsers(userIds) {
    return inChunks(userIds, (chunk) => db().from("member_about").select<MemberAboutRow>(COLUMNS).in("user_id", chunk));
  },
};
