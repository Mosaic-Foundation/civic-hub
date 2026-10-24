// civic.review's store (src/modules/civic.review/store.ts): the
// `process_reviews`, `review_turns` and `process_links` tables, the
// submit_for_review function and the account's reviews_seen_at, on the hub in
// scope. The review's reads and writes of `processes` are in
// src/services/processRows.ts.

import { forHub, type HubDb } from "../db/forHub.js";
import { transitionProcess } from "../db/atomic.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { ProcessReview, ReviewStatus, ReviewTurn } from "../modules/civic.review/models.js";
import type { ReviewStore } from "../modules/civic.review/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const reviewStoreImpl: ReviewStore = {
  async submitForReview(rows) {
    // The process, its links, the review, the process's link back to it, the
    // first turn and the event: one transaction (submit_for_review,
    // 20261024000000), stamped with the hub it was submitted on.
    return db().rpc<{ review: ProcessReview; links_skipped: number }>("submit_for_review", {
      p_process: rows.process,
      p_review: rows.review,
      p_turn: rows.turn,
      p_links: rows.links,
      p_event: rows.event,
    });
  },

  async transitionProcess(input) {
    return transitionProcess(input);
  },

  async claimPendingReview(reviewId) {
    // Only the first caller matches the WHERE clause; a concurrent or
    // duplicate approve affects 0 rows.
    const claimedRows = await db()
      .from("process_reviews")
      .update({ status: "approved" as ReviewStatus })
      .eq("id", reviewId)
      .eq("status", "pending_review")
      .select();
    return claimedRows.length === 0 ? null : (claimedRows[0] as unknown as ProcessReview);
  },

  async setReviewStatus(reviewId, status) {
    await db().from("process_reviews").update({ status }).eq("id", reviewId);
  },

  async updateReview(reviewId, patch) {
    return (await db().from("process_reviews").update(patch).eq("id", reviewId).select().single()) as unknown as ProcessReview;
  },

  async insertTurn(turn) {
    await db().from("review_turns").insert({ ...turn });
  },

  async latestTurnNumber(reviewId) {
    const data = await db()
      .from("review_turns")
      .select<{ turn_number: number }>("turn_number")
      .eq("review_id", reviewId)
      .order("turn_number", { ascending: false })
      .limit(1);
    if (data.length === 0) return null;
    return Number(data[0].turn_number);
  },

  async deleteLinksCreatedBy(processId, creatorId) {
    await db().from("process_links").delete().eq("from_id", processId).eq("created_by", creatorId);
  },

  async reviewById(reviewId) {
    return db().from("process_reviews").select<ProcessReview>("*").eq("id", reviewId).maybeSingle();
  },

  async reviewOfProcess(processId) {
    return db().from("process_reviews").select<ProcessReview>("*").eq("process_id", processId).maybeSingle();
  },

  async turnsOf(reviewId) {
    return db()
      .from("review_turns")
      .select<ReviewTurn>("*")
      .eq("review_id", reviewId)
      .order("turn_number", { ascending: true });
  },

  async allReviews(status) {
    return readAll((from, to) => {
      let query = db()
        .from("process_reviews")
        .select<ProcessReview>("*")
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true });

      if (status) {
        query = query.eq("status", status);
      }
      return query.range(from, to);
    });
  },

  async reviewsOfCreator(creatorId) {
    return readAll((from, to) =>
      db()
        .from("process_reviews")
        .select<ProcessReview>("*")
        .eq("creator_id", creatorId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
  },

  async reviewProcessesNeedingAttention({ userId, isAdmin, since }) {
    return readAll((from, to) => {
      let query = db()
        .from("process_reviews")
        .select<{ process_id: string }>("process_id")
        .gt("updated_at", since);

      if (isAdmin) {
        query = query.eq("status", "pending_review");
      } else {
        query = query.eq("creator_id", userId).eq("status", "changes_requested");
      }
      return query.order("id", { ascending: true }).range(from, to);
    });
  },

  async fillDraftId(reviewId, draftId) {
    await db().from("process_reviews").update({ draft_id: draftId }).eq("id", reviewId).is("draft_id", null);
  },

  async reviewsSeenAt(userId) {
    const userRow = await db()
      .from("users")
      .select<{ reviews_seen_at: string | null }>("reviews_seen_at")
      .eq("id", userId)
      .maybeSingle();
    return userRow?.reviews_seen_at ?? null;
  },

  async setReviewsSeenAt(userId, seenAt) {
    await db().from("users").update({ reviews_seen_at: seenAt }).eq("id", userId);
  },
};
