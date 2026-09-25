// Brief responses service — storage for official responses to briefs.
//
// The rules live in src/modules/civic.brief/responses.ts (pure); this
// file owns every read and write of the brief_responses table plus the
// responder-name resolution the public projection needs.
//
// Degradation contract (same as the officials service): READS against a
// database that has not applied 20260828000000_brief_responses.sql log
// and return empty — the brief page must keep rendering, just with no
// response section. WRITES fail loudly — silently dropping an official's
// public statement is worse than a 500.

import { forHub, type HubDb } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { generateId } from "../utils/id.js";
import type { BriefResponseRecord } from "../modules/civic.brief/index.js";

/** The hub in scope. Brief responses are only ever read or written inside one. */
function db(): HubDb {
  return forHub(currentHubId());
}

interface ResponseRow {
  id: string;
  brief_id: string;
  responder_id: string;
  official_type: string;
  official_title: string;
  body: string;
  feed_anchor: boolean;
  created_at: string;
}

/** All responses for one brief. Order is left to the pure projection. */
export async function listResponsesForBrief(
  briefId: string,
): Promise<BriefResponseRecord[]> {
  try {
    return await db()
      .from("brief_responses")
      .select<ResponseRow>("*")
      .eq("brief_id", briefId);
  } catch (err) {
    console.error(
      `[briefResponses] list failed, returning none: ${(err as Error).message}`,
    );
    return [];
  }
}

/**
 * Timestamp of the most recent ANCHORED response for a brief, or null.
 * Feeds the pure isFeedAnchor decision — see responses.ts for why the
 * window keys on the last anchor rather than the last response.
 */
export async function latestAnchorAt(briefId: string): Promise<string | null> {
  try {
    const row = await db()
      .from("brief_responses")
      .select<{ created_at: string }>("created_at")
      .eq("brief_id", briefId)
      .eq("feed_anchor", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return row?.created_at ?? null;
  } catch (err) {
    console.error(
      `[briefResponses] anchor lookup failed, treating as none: ${(err as Error).message}`,
    );
    return null;
  }
}

/** Persist one response. Returns the stored record. */
export async function insertResponse(input: {
  brief_id: string;
  responder_id: string;
  official_type: string;
  official_title: string;
  body: string;
  feed_anchor: boolean;
}): Promise<BriefResponseRecord> {
  const row = { id: generateId("bresp"), ...input };
  return await db()
    .from("brief_responses")
    .insert(row)
    .select<ResponseRow>("*")
    .single();
}

/**
 * Resolve responder display names in one batched query, keyed by user
 * id. Same precedence the rest of the hub renders authors with
 * (full_name ?? display_name), falling back to the office title's
 * holder being nameless — "Official" — rather than leaking an email.
 */
export async function responderNames(
  responderIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(responderIds)];
  if (unique.length === 0) return names;
  let rows: Array<{
    id: string;
    full_name?: string | null;
    display_name?: string | null;
  }>;
  try {
    rows = await db()
      .from("users")
      .select<{ id: string; full_name?: string | null; display_name?: string | null }>("*")
      .in("id", unique);
  } catch (err) {
    console.error(`[briefResponses] name lookup failed: ${(err as Error).message}`);
    return names;
  }
  for (const row of rows) {
    const name = row.full_name?.trim() || row.display_name?.trim() || "";
    if (name) names.set(row.id, name);
  }
  return names;
}
