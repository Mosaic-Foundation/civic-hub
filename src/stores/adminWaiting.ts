// civic.admin_waiting's store (src/modules/civic.admin_waiting/store.ts): its
// reads of review turns, events and the waitlist, on the hub in scope
// (ADR-012). The Admin digest's mark is the plugin's (features/admin_digest).

import { forHub, type HubDb } from "../db/forHub.js";
import { inChunks } from "../db/inChunks.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { AdminWaitingStore } from "../modules/civic.admin_waiting/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const adminWaitingStoreImpl: AdminWaitingStore = {
  async latestSubmissions(reviewIds) {
    // Chunked by id, and each chunk paged: a chunk's reviews can have more than
    // 1,000 turns between them (PostgREST's cap).
    const rows = await inChunks([...reviewIds], (chunk) =>
      readAll((from, to) =>
        db()
          .from("review_turns")
          .select<{ review_id: string; created_at: string }>("review_id, created_at")
          .in("review_id", chunk)
          .in("action", ["submit", "revise_resubmit"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    const latest = new Map<string, string>();
    for (const r of rows) {
      const prev = latest.get(r.review_id);
      if (!prev || r.created_at > prev) latest.set(r.review_id, r.created_at);
    }
    return latest;
  },

  async editEvents(since, until) {
    type EditEvent = { process_id: string; data: Record<string, unknown> | null };
    return readAll((from, to) =>
      db()
        .from("events")
        .select<EditEvent>("process_id, data")
        .eq("event_type", "civic.process.updated")
        .gt("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  },

  async waitlistRows() {
    return readAll((from, to) =>
      db()
        .from("waitlist")
        .select<{ email: string; created_at: string; told_open_at: string | null }>("email, created_at, told_open_at")
        .order("created_at", { ascending: true })
        .order("email", { ascending: true })
        .range(from, to),
    );
  },
};
