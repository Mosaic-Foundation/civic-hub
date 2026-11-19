// Brief responses: storage for official responses to briefs.
//
// The rules live in ./responses.ts (pure); this file owns every read and
// write of the package's brief_responses table (through the host's granted
// database) and asks the kernel for the responders' names.
//
// Degradation contract (same as the officials service): READS against a
// database that has not applied 20260828000000_brief_responses.sql log
// and return empty — the brief page must keep rendering, just with no
// response section. WRITES fail loudly — silently dropping an official's
// public statement is worse than a 500.

import { generateId, offices } from "@civic-social/plugin-sdk";
import { briefHost } from "./host.js";
import type { BriefResponseRecord } from "./responses.js";

/** The package's own table, for the hub in scope (the host refuses any other). */
function responsesTable() {
  return briefHost.get().db().from("brief_responses");
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
    return await responsesTable()
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
    const row = await responsesTable()
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
  return await responsesTable()
    .insert(row)
    .select<ResponseRow>("*")
    .single();
}

/**
 * Responder display names in one batched read, keyed by user id: the same
 * precedence the rest of the hub renders authors with (full_name ??
 * display_name). A responder with neither is left out and shown as
 * "Official", never by an email.
 */
export function responderNames(responderIds: string[]): Promise<Map<string, string>> {
  return offices.onRecordNames(responderIds);
}
