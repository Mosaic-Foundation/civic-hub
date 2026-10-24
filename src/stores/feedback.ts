// civic.feedback's store (src/modules/civic.feedback/store.ts): the
// `feedback_submissions` table, on the hub in scope, and the platform's inbox
// for the copy Civic.Social gets (ADR-012).

import { forHub, type HubDb } from "../db/forHub.js";
import { copyToMosaic } from "../db/platformFeedback.js";
import { currentHubId } from "../config/hubContext.js";
import type { FeedbackStore } from "../modules/civic.feedback/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const feedbackStoreImpl: FeedbackStore = {
  async insertSubmission(row) {
    return await db().from("feedback_submissions").insert(row).select().single();
  },

  async findSubmission(id) {
    const rows = await db().from("feedback_submissions").select("*").eq("id", id).limit(1);
    return rows[0] as Record<string, unknown> | undefined;
  },

  async listSubmissions({ limit, category, since }) {
    let query = db()
      .from("feedback_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);
    if (since) query = query.gte("created_at", since);

    return await query;
  },

  async recordMosaicCopy(id, record) {
    return await db().from("feedback_submissions").update(record).eq("id", id).select().single();
  },

  copyToMosaic,
};
