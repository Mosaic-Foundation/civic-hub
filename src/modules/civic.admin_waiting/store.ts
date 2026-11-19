// What civic.admin_waiting reads, as the host supplies it (ADR-012, the
// database convention): the module never imports src/db/. The implementation
// is src/stores/adminWaiting.ts, bound at startup by installStores(). The
// functions below call the bound store; the service and the unit tests that
// stand the reads in name them here. The Admin digest's mark is the plugin's
// own table (features/admin_digest/store.ts).

import { storeSlot } from "../../processes/storeSlot.js";

export interface AdminWaitingStore {
  /** Each pending review's latest submission (submit or resubmit), from the append-only turns. */
  latestSubmissions(reviewIds: readonly string[]): Promise<Map<string, string>>;
  /** The edit events recorded in (since, until]. */
  editEvents(
    since: string,
    until: string,
  ): Promise<Array<{ process_id: string; data: Record<string, unknown> | null }>>;
  /** Everyone on the waitlist. */
  waitlistRows(): Promise<Array<{ email: string; created_at: string; told_open_at: string | null }>>;
}

export const adminWaitingStore = storeSlot<AdminWaitingStore>("civic.admin_waiting");

export function latestSubmissions(reviewIds: readonly string[]): Promise<Map<string, string>> {
  return adminWaitingStore.get().latestSubmissions(reviewIds);
}

export function editEvents(
  since: string,
  until: string,
): Promise<Array<{ process_id: string; data: Record<string, unknown> | null }>> {
  return adminWaitingStore.get().editEvents(since, until);
}

export function waitlistRows(): Promise<Array<{ email: string; created_at: string; told_open_at: string | null }>> {
  return adminWaitingStore.get().waitlistRows();
}
