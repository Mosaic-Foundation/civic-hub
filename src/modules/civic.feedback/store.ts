// What civic.feedback keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/feedback.ts, bound at startup by installStores().

import { storeSlot } from "../../processes/storeSlot.js";
import type { MosaicCopyInput, MosaicStatus } from "../../db/platformFeedback.js";

/** A `feedback_submissions` row, as the table has it. */
export type FeedbackRow = Record<string, unknown>;

/** What a hub's row records once Civic.Social has a copy of it. */
export interface MosaicRecord {
  mosaic_item_id: string;
  mosaic_stream: string;
  mosaic_status: MosaicStatus;
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
  /** Write Civic.Social's copy in the platform's inbox (a cross-hub write); its id and status. */
  copyToMosaic(input: MosaicCopyInput): Promise<{ id: string; status: MosaicStatus }>;
}

export const feedbackStore = storeSlot<FeedbackStore>("civic.feedback");
