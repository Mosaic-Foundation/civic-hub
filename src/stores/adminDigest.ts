// civic.admin_digest's store (src/modules/civic.admin_digest/store.ts): the
// digest's reads of review turns, feedback, events and the waitlist, and its
// mark (`admin_digest_marks`), on the hub in scope (ADR-012).

import { forHub, HubDbError, type HubDb } from "../db/forHub.js";
import { inChunks } from "../db/inChunks.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import type { AdminDigestStore } from "../modules/civic.admin_digest/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

export const adminDigestStoreImpl: AdminDigestStore = {
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

  async countFeedback(since, until) {
    return db().from("feedback_submissions").count().gt("created_at", since).lte("created_at", until);
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

  async readMark() {
    const row = await db().from("admin_digest_marks").select<{ covered_until: string }>("covered_until").maybeSingle();
    return row?.covered_until ?? null;
  },

  async moveMark(from, to) {
    if (from === null) {
      try {
        await db().from("admin_digest_marks").insert({ covered_until: to, updated_at: new Date().toISOString() });
        return true;
      } catch (err) {
        if (err instanceof HubDbError && err.code === "23505") return false;
        throw err;
      }
    }
    const moved = await db()
      .from("admin_digest_marks")
      .update({ covered_until: to, updated_at: new Date().toISOString() })
      .eq("covered_until", from)
      .select<{ covered_until: string }>("covered_until");
    return moved.length > 0;
  },

  async releaseMark(claimed, previous) {
    if (previous === null) {
      await db().from("admin_digest_marks").delete().eq("covered_until", claimed);
    } else {
      await db()
        .from("admin_digest_marks")
        .update({ covered_until: previous, updated_at: new Date().toISOString() })
        .eq("covered_until", claimed);
    }
  },
};
