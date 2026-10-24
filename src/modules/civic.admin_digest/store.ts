// What civic.admin_digest keeps and reads, as the host supplies it (ADR-012,
// the database convention): the module never imports src/db/. The
// implementation is src/stores/adminDigest.ts, bound at startup by
// installStores(). The functions below call the bound store; the service and
// the unit tests that stand the digest's reads in name them here.

import { storeSlot } from "../../processes/storeSlot.js";

export interface AdminDigestStore {
  /** Each pending review's latest submission (submit or resubmit), from the append-only turns. */
  latestSubmissions(reviewIds: readonly string[]): Promise<Map<string, string>>;
  /** Feedback received in (since, until]. */
  countFeedback(since: string, until: string): Promise<number>;
  /** The edit events recorded in (since, until]. */
  editEvents(
    since: string,
    until: string,
  ): Promise<Array<{ process_id: string; data: Record<string, unknown> | null }>>;
  /** Everyone on the waitlist. */
  waitlistRows(): Promise<Array<{ email: string; created_at: string; told_open_at: string | null }>>;
  /** Where the last digest that went out covered up to; null when none has. */
  readMark(): Promise<string | null>;
  /**
   * Move the mark from `from` (null: there is none yet) to `to`, only if it is
   * still at `from`. False when another run moved it first.
   */
  moveMark(from: string | null, to: string): Promise<boolean>;
  /** Give a claimed window back: the mark returns to where it was. */
  releaseMark(claimed: string, previous: string | null): Promise<void>;
}

export const adminDigestStore = storeSlot<AdminDigestStore>("civic.admin_digest");

export function latestSubmissions(reviewIds: readonly string[]): Promise<Map<string, string>> {
  return adminDigestStore.get().latestSubmissions(reviewIds);
}

export function countFeedback(since: string, until: string): Promise<number> {
  return adminDigestStore.get().countFeedback(since, until);
}

export function editEvents(
  since: string,
  until: string,
): Promise<Array<{ process_id: string; data: Record<string, unknown> | null }>> {
  return adminDigestStore.get().editEvents(since, until);
}

export function waitlistRows(): Promise<Array<{ email: string; created_at: string; told_open_at: string | null }>> {
  return adminDigestStore.get().waitlistRows();
}

export function readMark(): Promise<string | null> {
  return adminDigestStore.get().readMark();
}

export function moveMark(from: string | null, to: string): Promise<boolean> {
  return adminDigestStore.get().moveMark(from, to);
}

export function releaseMark(claimed: string, previous: string | null): Promise<void> {
  return adminDigestStore.get().releaseMark(claimed, previous);
}
