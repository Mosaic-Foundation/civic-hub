// readAll — "every row that matches", read in pages.
//
// PostgREST answers one request with at most POSTGREST_MAX_ROWS (1,000) rows
// and does not say there were more. forHub() refuses a read with no limit that
// comes back full (code CIVIC_ROW_CAP), so a read that may be long either asks
// for a window (`.limit()`, `.range()`) or comes through here.
//
// Prefer a query that asks for what it needs: a page for a list a person
// scrolls, a filter by type or process for a check. readAll is for the reads
// that really need every match (a moderation log, a sweep, a set of ids).
//
// The caller builds the query and must ORDER it by a unique key (or a key plus
// a unique tiebreaker, e.g. created_at then id), or pages can overlap and skip
// rows. Offset paging: a row inserted mid-read in an earlier page's range
// shifts later pages by one, so a long read of a busy table can see a row
// twice or, for rows inserted before the cursor, miss one. Callers that de-dupe
// by id are safe from the first; the second needs keyset paging instead.

import { POSTGREST_MAX_ROWS } from "./forHub.js";

/** Rows per request: the server's cap, so no request is cut short. */
export const READ_ALL_PAGE = POSTGREST_MAX_ROWS;

/**
 * Read every row a query matches. `page(from, to)` returns the query for rows
 * `from`..`to` inclusive, i.e. the caller's ordered query ending in
 * `.range(from, to)`.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<T[]>,
  size: number = READ_ALL_PAGE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const batch = await page(from, from + size - 1);
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}
