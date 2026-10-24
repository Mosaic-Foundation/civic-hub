// civic.wordcloud's store (src/modules/civic.wordcloud/store.ts): the
// `wordcloud_submissions` table, on the hub in scope.

import { forHub, HubDbError, type HubDb } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { ResponseRow, SubmissionRow, WordcloudStore } from "../modules/civic.wordcloud/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const wordcloudStoreImpl: WordcloudStore = {
  async countSubmissions({ processId, promptId, authorId, visibleOnly }) {
    let q = db().from("wordcloud_submissions").count().eq("process_id", processId);
    if (promptId !== undefined) q = q.eq("prompt_id", promptId);
    if (authorId !== undefined) q = q.eq("author_id", authorId);
    if (visibleOnly) q = q.is("hidden_at", null);
    return await q;
  },

  async insertSubmission(row) {
    try {
      return await db().from("wordcloud_submissions").insert(row).select<SubmissionRow>().single();
    } catch (err) {
      // The unique index on (process, prompt, author), 20260617000000.
      if (row.author_id && err instanceof HubDbError && err.code === "23505") return "duplicate";
      throw err;
    }
  },

  async visibleBodies(processId, promptId) {
    const rows = await readAll((from, to) =>
      db()
        .from("wordcloud_submissions")
        .select<{ body: string }>("body")
        .eq("process_id", processId)
        .eq("prompt_id", promptId)
        .is("hidden_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => r.body);
  },

  async visibleResponses(processId, promptId) {
    return readAll((from, to) => {
      let q = db()
        .from("wordcloud_submissions")
        .select<ResponseRow>("id, body, submitted_at, prompt_id")
        .eq("process_id", processId)
        .is("hidden_at", null)
        .order("submitted_at", { ascending: false })
        .order("id", { ascending: true });
      if (promptId) q = q.eq("prompt_id", promptId);
      return q.range(from, to);
    });
  },

  async deleteAll() {
    await db().from("wordcloud_submissions").delete().neq("id", "");
  },
};
