// The Feedback plugin's table, `feedback_submissions` (migration
// 20260429000000 and later), on the space in scope, through the plugin's own
// grant. Civic.Social's copy goes through the kernel's provider inbox, never
// from here.

import type { FeatureHost } from "../../src/sdk/index.js";

/** A `feedback_submissions` row, as the table has it. */
export type FeedbackRow = Record<string, unknown>;

/** What a hub's row records once Civic.Social has a copy of it. */
export interface MosaicRecord {
  mosaic_item_id: string;
  mosaic_stream: string;
  mosaic_status: "received" | "planned" | "fixed";
  mosaic_sent_at: string;
  mosaic_sent_by: string;
}

export interface FeedbackStore {
  /** Store one submission; the row as stored. */
  insertSubmission(row: FeedbackRow): Promise<FeedbackRow>;
  /** One submission by id, or undefined when there is none. */
  findSubmission(id: string): Promise<FeedbackRow | undefined>;
  /** Submissions newest first, at most `limit`, optionally one category, optionally created at or after `since`. */
  listSubmissions(where: { limit: number; category?: string; since?: string }): Promise<FeedbackRow[]>;
  /** Record that Civic.Social has a copy of a submission; the row as now stored. */
  recordMosaicCopy(id: string, record: MosaicRecord): Promise<FeedbackRow>;
  /** How many arrived after `since` and, when given, at or before `until` (the admin queue's count). */
  countSince(since: string, until?: string): Promise<number>;
}

export function feedbackStore(host: Pick<FeatureHost, "db">): FeedbackStore {
  const table = () => host.db().from("feedback_submissions");
  return {
    async insertSubmission(row) {
      return await table().insert(row).select().single();
    },
    async findSubmission(id) {
      const rows = await table().select("*").eq("id", id).limit(1);
      return rows[0] as FeedbackRow | undefined;
    },
    async listSubmissions({ limit, category, since }) {
      let query = table().select("*").order("created_at", { ascending: false }).limit(limit);
      if (category) query = query.eq("category", category);
      if (since) query = query.gte("created_at", since);
      return await query;
    },
    async recordMosaicCopy(id, record) {
      return await table().update(record).eq("id", id).select().single();
    },
    async countSince(since, until) {
      const q = table().count().gt("created_at", since);
      return until ? q.lte("created_at", until) : q;
    },
  };
}
