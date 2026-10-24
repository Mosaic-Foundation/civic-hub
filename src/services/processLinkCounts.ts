// How many process_links touch each of a set of processes, for the public
// outcomes index (briefController). Read-only, on the hub in scope; the
// controller does not query (ADR-012, the database convention). The link
// rules and the rest of the process_links reads live in processLinks.ts.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { readAll } from "../db/readAll.js";
import { inChunks } from "../db/inChunks.js";

/**
 * How many links touch each of these processes, in either direction. A failed
 * read throws: it used to be ignored, which showed a threaded outcome as
 * having no related processes.
 */
export async function countLinksTouching(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const db = forHub(currentHubId());
  // Chunked ids, each chunk paged: a long `in` list passes the URL limit, and
  // 200 processes can have more than 1,000 links (PostgREST's cap).
  const [out, inc] = await Promise.all([
    inChunks(ids, (chunk) =>
      readAll((from, to) =>
        db
          .from("process_links")
          .select<{ from_id: string }>("from_id")
          .in("from_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
    inChunks(ids, (chunk) =>
      readAll((from, to) =>
        db
          .from("process_links")
          .select<{ to_id: string }>("to_id")
          .in("to_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
  ]);
  for (const r of out) counts.set(r.from_id, (counts.get(r.from_id) ?? 0) + 1);
  for (const r of inc) counts.set(r.to_id, (counts.get(r.to_id) ?? 0) + 1);
  return counts;
}
