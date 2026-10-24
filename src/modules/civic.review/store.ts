// What civic.review keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/review.ts, bound at startup by installStores(). The review's
// reads and writes of the `processes` table are not here: they are
// src/services/processRows.ts.

import { storeSlot } from "../../processes/storeSlot.js";
import type { transitionProcess } from "../../db/atomic.js";
import type { EventRow } from "../../events/eventStore.js";
import type { ProcessReview, ProcessSnapshot, ReviewStatus, ReviewTurn } from "./models.js";

/** The rows of one submission, as the database function writes them in one transaction. */
export interface SubmissionWrite {
  /** The new `processes` row, status pending_review. */
  process: Record<string, unknown>;
  /** The new `process_reviews` row. */
  review: Record<string, unknown>;
  /** The first `review_turns` row. */
  turn: Record<string, unknown>;
  /** The creator's proposed links to other processes. */
  links: Array<Record<string, unknown>>;
  /** The review.submitted event, as an events row. */
  event: EventRow;
}

/** A new `review_turns` row. */
export interface NewTurn {
  id: string;
  review_id: string;
  turn_number: number;
  actor: string;
  actor_role: string;
  action: string;
  note: string | null;
  process_snapshot: ProcessSnapshot | null;
}

export interface ReviewStore {
  /**
   * The process, its links, the review, the process's link back to it, the
   * first turn and the event, in one transaction (submit_for_review).
   * links_skipped counts links whose target is gone or already linked.
   */
  submitForReview(rows: SubmissionWrite): Promise<{ review: ProcessReview; links_skipped: number }>;
  /**
   * Write a process's status and state, the events its action emitted, and the
   * event recording a status change, in one transaction (transition_process);
   * refuses with ProcessChangedError when the row is no longer as expected.
   */
  transitionProcess(input: Parameters<typeof transitionProcess>[0]): ReturnType<typeof transitionProcess>;
  /** Claim a pending review as approved in one conditional update: the row, or null when it was no longer pending. */
  claimPendingReview(reviewId: string): Promise<ProcessReview | null>;
  /** Set a review's status, nothing else. */
  setReviewStatus(reviewId: string, status: ReviewStatus): Promise<void>;
  /** Update a review's columns and return the row now. */
  updateReview(reviewId: string, patch: Record<string, unknown>): Promise<ProcessReview>;
  /** Append a turn to a review. */
  insertTurn(turn: NewTurn): Promise<void>;
  /** The number of a review's latest turn, or null when it has none. */
  latestTurnNumber(reviewId: string): Promise<number | null>;
  /** Remove the links one account made from a process (a revision replaces them). */
  deleteLinksCreatedBy(processId: string, creatorId: string): Promise<void>;
  /** One review, or null. */
  reviewById(reviewId: string): Promise<ProcessReview | null>;
  /** The review of a process, or null. */
  reviewOfProcess(processId: string): Promise<ProcessReview | null>;
  /** A review's turns, oldest first. */
  turnsOf(reviewId: string): Promise<ReviewTurn[]>;
  /** Every review, last updated first, optionally one status (paged past 1,000). */
  allReviews(status?: string): Promise<ProcessReview[]>;
  /** One creator's reviews, last updated first (paged past 1,000). */
  reviewsOfCreator(creatorId: string): Promise<ProcessReview[]>;
  /**
   * The processes of the reviews that need this person's attention and changed
   * after `since`: the pending queue for an admin, their own with changes
   * requested for anyone else (paged past 1,000).
   */
  reviewProcessesNeedingAttention(args: { userId: string; isAdmin: boolean; since: string }): Promise<Array<{ process_id: string }>>;
  /** Record the draft a review came from, only where it has none. */
  fillDraftId(reviewId: string, draftId: string): Promise<void>;
  /** When this account last looked at its reviews, or null. */
  reviewsSeenAt(userId: string): Promise<string | null>;
  /** Stamp when this account last looked at its reviews. */
  setReviewsSeenAt(userId: string, seenAt: string): Promise<void>;
}

export const reviewStore = storeSlot<ReviewStore>("civic.review");
