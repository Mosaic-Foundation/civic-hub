// civic.projects' store (src/modules/civic.projects/store.ts): the `projects`,
// `project_sentiments` and `project_drafts` tables, and the project's rows in
// `community_inputs`, on the hub in scope.

import { forHub, type HubDb } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { ProjectRow, ProjectsStore, UpdateInputRow } from "../modules/civic.projects/store.js";
import type { ProjectStatus, SentimentValue } from "../modules/civic.projects/models.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const projectsStoreImpl: ProjectsStore = {
  async insertProject(row) {
    return await db().from("projects").insert(row).select<ProjectRow>().single();
  },

  async findProject(id) {
    return await db().from("projects").select<ProjectRow>("*").eq("id", id).maybeSingle();
  },

  async listProjects(status) {
    return readAll((from, to) => {
      let query = db()
        .from("projects")
        .select<ProjectRow>("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });

      if (status) {
        query = query.eq("status", status);
      } else {
        // Default-exclude archived, for the same reason as proposals: an
        // unfiltered list is the public list.
        query = query.neq("status", "archived");
      }

      return query.range(from, to);
    });
  },

  async updateProject(id, updates) {
    return await db().from("projects").update(updates).eq("id", id).select<ProjectRow>().single();
  },

  async patchProject(id, patch) {
    await db().from("projects").update(patch).eq("id", id);
  },

  async completeIfActive(id) {
    await db()
      .from("projects")
      .update({ status: "completed" as ProjectStatus, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "active");
  },

  async statusOf(id) {
    const row = await db().from("projects").select<{ status?: string }>("status").eq("id", id).maybeSingle();
    return row?.status;
  },

  async setStatus(id, status) {
    await db()
      .from("projects")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
  },

  async updateInputs(projectId) {
    return await db()
      .from("community_inputs")
      .select<UpdateInputRow>("id, process_id, body, submitted_at")
      .eq("process_id", projectId)
      .eq("phase", "update")
      .is("hidden_at", null)
      .order("submitted_at", { ascending: false });
  },

  async countComments(projectId) {
    return await db()
      .from("community_inputs")
      .count()
      .eq("process_id", projectId)
      .neq("phase", "update")
      .is("hidden_at", null);
  },

  async deleteSentiment(projectId, userId) {
    await db()
      .from("project_sentiments")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);
  },

  async upsertSentiment(projectId, userId, sentiment) {
    await db()
      .from("project_sentiments")
      .upsert(
        { project_id: projectId, user_id: userId, sentiment },
        { onConflict: "hub_id,project_id,user_id" },
      );
  },

  async sentimentOf(projectId, userId) {
    const data = await db()
      .from("project_sentiments")
      .select<{ sentiment: SentimentValue }>("sentiment")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    return data.sentiment;
  },

  async countSentiments(projectId, sentiment) {
    return await db()
      .from("project_sentiments")
      .count()
      .eq("project_id", projectId)
      .eq("sentiment", sentiment);
  },

  async setSentimentCounts(projectId, { support_count, oppose_count }) {
    await db()
      .from("projects")
      .update({ support_count, oppose_count, updated_at: new Date().toISOString() })
      .eq("id", projectId);
  },

  async supporterIds(projectId) {
    // Paged: a project can have more than 1,000 supporters (PostgREST's cap).
    const rows = await readAll((from, to) =>
      db()
        .from("project_sentiments")
        .select<{ user_id: string }>("user_id")
        .eq("project_id", projectId)
        .eq("sentiment", "support")
        .order("user_id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => r.user_id);
  },

  async supportedProjectIds(userId) {
    const rows = await db()
      .from("project_sentiments")
      .select<{ project_id: string }>("project_id")
      .eq("user_id", userId)
      .eq("sentiment", "support");
    return rows.map((r) => r.project_id);
  },

  async resetDraftReview(draftId) {
    await db()
      .from("project_drafts")
      .update({ last_review_result: null, draft_modified_since_review: true, coc_checked_hash: null })
      .eq("id", draftId);
  },

  async deleteAll() {
    const hubDb = db();
    await hubDb.from("project_sentiments").delete().neq("project_id", "");
    await hubDb.from("projects").delete().neq("id", "");
  },
};
