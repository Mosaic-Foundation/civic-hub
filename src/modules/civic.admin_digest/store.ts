// civic.admin_digest store — every database read and write the digest makes,
// in one place, so the unit tests can stand them in (tests/unit/
// jobRunVisibility.test.ts). The API tests run them for real.

import { forHub, HubDbError } from "../../db/forHub.js";
import { currentHubId } from "../../config/hubContext.js";
import { inChunks } from "../../db/inChunks.js";
import { readAll } from "../../db/readAll.js";

function db() {
  return forHub(currentHubId());
}

export /** Each pending review's latest submission (submit or resubmit), from the append-only turns. */
async function latestSubmissions(reviewIds: readonly string[]): Promise<Map<string, string>> {
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
}

/** Feedback received in (since, until]. */
export async function countFeedback(since: string, until: string): Promise<number> {
  return db().from("feedback_submissions").count().gt("created_at", since).lte("created_at", until);
}

/** The edit events recorded in (since, until]. */
export async function editEvents(
  since: string,
  until: string,
): Promise<Array<{ process_id: string; data: Record<string, unknown> | null }>> {
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
}

/** Everyone on the waitlist. */
export async function waitlistRows(): Promise<Array<{ email: string; created_at: string; told_open_at: string | null }>> {
  return readAll((from, to) =>
    db()
      .from("waitlist")
      .select<{ email: string; created_at: string; told_open_at: string | null }>("email, created_at, told_open_at")
      .order("created_at", { ascending: true })
      .order("email", { ascending: true })
      .range(from, to),
  );
}

// --- The mark ---------------------------------------------------------------

export async function readMark(): Promise<string | null> {
  const row = await db().from("admin_digest_marks").select<{ covered_until: string }>("covered_until").maybeSingle();
  return row?.covered_until ?? null;
}

/**
 * Move the mark from `from` (null: there is none yet) to `to`, only if it is
 * still at `from`. False when another run moved it first.
 */
export async function moveMark(from: string | null, to: string): Promise<boolean> {
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
}

/** Give a claimed window back: the mark returns to where it was. */
export async function releaseMark(claimed: string, previous: string | null): Promise<void> {
  if (previous === null) {
    await db().from("admin_digest_marks").delete().eq("covered_until", claimed);
  } else {
    await db()
      .from("admin_digest_marks")
      .update({ covered_until: previous, updated_at: new Date().toISOString() })
      .eq("covered_until", claimed);
  }
}

