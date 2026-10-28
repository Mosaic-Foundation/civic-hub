// Brief controller — public read endpoint for published civic.brief
// records (the universal, permanent public record of a completed process).
//
// Only publication_status = "published" records are returned; pending and
// approved records 404 so they stay invisible until an admin publishes.

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  route,
  getProcess,
  publishedBriefRows,
  countLinksTouching,
  emitEvent,
  getAuthUser,
  insertResponse,
  latestAnchorAt,
  listResponsesForBrief,
  responderNames,
} from "@civic-social/plugin-sdk/first-party";
import { Request, Response } from "express";
import type { OfficialIdentity } from "../../src/shared/officialTypes.js";
import {
  availableSourceTypes,
  availableYears,
  emitBriefResponseAdded,
  filterIndex,
  getPublicReadModel,
  isFeedAnchor,
  normalizeResponseBody,
  respondGate,
  responseExcerpt,
  responseStatus,
  toIndexEntry,
  toPublicResponses,
  type BriefProcessState,
} from "./api.js";

export const handleGetBrief = route(async (req, res) => {
  const id = req.params.id as string;
  const process = await getProcess(id);
  if (!process || process.definition.type !== "civic.brief") {
    throw new NotFoundError("Brief not found");
  }
  const model = getPublicReadModel(
    process.state as unknown as BriefProcessState,
    { id: process.id, title: process.title, createdAt: process.createdAt },
  );
  if (!model) {
    // Pending or approved-but-not-published — invisible to the public.
    throw new NotFoundError("Brief not found");
  }

  // Official responses + the page's Awaiting/Responded status. The
  // responder's account id stays server-side; only the resolved name
  // and the office snapshot go over the wire.
  const records = await listResponsesForBrief(process.id);
  const names = await responderNames(records.map((r) => r.responder_id));
  const status = responseStatus(records);
  res.json({
    ...model,
    response_status: status.status,
    responded_at: status.responded_at,
    responses: toPublicResponses(
      records,
      (rid) => names.get(rid) ?? "Official",
    ),
    ...(process.isSample ? { is_sample: true } : {}),
  });
});

/**
 * POST /brief/:id/response — an official goes on the record about a
 * published brief. Route-gated by requireOfficial (residents and plain
 * admins 403 before reaching here); the published-only rule and body
 * validation live in the pure respondGate/normalizeResponseBody.
 *
 * Append-only by design: any official may respond to any published
 * brief, and may respond again later — a follow-up is a new row, never
 * an edit. Every response emits its event; at most one per brief per
 * 24h is anchored for the feed (see isFeedAnchor).
 */
export const handlePostBriefResponse = route(async (req, res) => {
  const id = req.params.id as string;
  const official = res.locals.officialIdentity as OfficialIdentity | undefined;

  const record = await getProcess(id);
  const state =
    record && record.definition.type === "civic.brief"
      ? (record.state as unknown as BriefProcessState)
      : null;

  const gate = respondGate(official ?? null, state);
  if (gate) {
    if (gate.status === 403) throw new ForbiddenError(gate.error, "official_required");
    if (gate.status === 404) throw new NotFoundError(gate.error);
    throw new ConflictError(gate.error, "brief_not_published");
  }
  // respondGate returned null, so both are present.
  const briefState = state!;
  const identity = official!;

  const body = normalizeResponseBody((req.body ?? {}).body);

  const user = getAuthUser(res);
  const anchor = isFeedAnchor(await latestAnchorAt(id), new Date());
  const stored = await insertResponse({
    brief_id: id,
    responder_id: user.id,
    official_type: identity.type,
    official_title: identity.title,
    body,
    feed_anchor: anchor,
  });

  await emitBriefResponseAdded(
    {
      process_id: record!.id,
      jurisdiction: record!.jurisdiction,
      emit: emitEvent,
    },
    user.id,
    briefState,
    {
      excerpt: responseExcerpt(body),
      official_type: identity.type,
      official_title: identity.title,
      responder_name:
        user.full_name?.trim() || user.display_name?.trim() || "Official",
      feed_anchor: anchor,
    },
  );

  const records = await listResponsesForBrief(id);
  const names = await responderNames(records.map((r) => r.responder_id));
  const status = responseStatus(records);
  res.status(201).json({
    message: "Response posted.",
    response_id: stored.id,
    response_status: status.status,
    responded_at: status.responded_at,
    responses: toPublicResponses(
      records,
      (rid) => names.get(rid) ?? "Official",
    ),
  });
});


/** The outcomes index's filters, parsed from the query string at the edge. */
export interface OutcomesQuery {
  sourceTypes: string[];
  year: number | null;
  sort: "newest" | "oldest";
}

export function parseOutcomesQuery(query: Request["query"]): OutcomesQuery {
  const typeParam = query.source_type;
  const yearRaw = typeof query.year === "string" ? Number(query.year) : NaN;
  return {
    sourceTypes: (Array.isArray(typeParam) ? typeParam : [typeParam]).filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    ),
    year: Number.isFinite(yearRaw) ? yearRaw : null,
    sort: query.sort === "oldest" ? "oldest" : "newest",
  };
}

/**
 * The public outcomes index for the hub in scope: every published brief,
 * newest first unless asked otherwise.
 *
 * Filtering and sorting happen in the pure module (civic.brief/filterIndex)
 * rather than in SQL, deliberately: the set is small — one row per completed
 * process, for the life of the hub — and a hub with tens of thousands of
 * outcomes has bigger problems than this query. Keeping it pure means the
 * whole behaviour of the page is testable without a database, which is the
 * layer CI actually runs.
 */
export async function listOutcomes(q: OutcomesQuery) {
  // Published briefs that are still public. Archiving a brief sets the
  // process status, not publication_status, and this index used to look
  // only at the latter — an archived brief stayed on Outcomes while its
  // own page 404'd (Adam, 2026-09-06). Same non-public set every other
  // public read uses.
  const rows = await publishedBriefRows();

  // Count links on each brief's SOURCE process, not on the brief itself.
  // A brief owns almost no stored links — its relationships are derived
  // (the brief ⇄ source pair) or projected from the source. Counting the
  // brief's own rows would report 0 for an outcome that visibly shows
  // several, which is worse than showing nothing. What a reader wants to
  // know is whether this outcome sits in a thread, and that lives on the
  // process it summarizes.
  const sourceIds = rows
    .map((r) => (r.state as { source_process_id?: unknown }).source_process_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const relatedCounts = await countLinksTouching(sourceIds);

  const entries = rows
    .map((r) => {
      const sourceId = (r.state as { source_process_id?: unknown }).source_process_id;
      const entry = toIndexEntry(
        r.state as unknown as BriefProcessState,
        { id: r.id, title: r.title ?? "(untitled)" },
        typeof sourceId === "string" ? (relatedCounts.get(sourceId) ?? 0) : 0,
      );
      // Sample content (Phase 7): listed, with the Sample badge.
      // A visitor's demo submission is stored as sample but has no badge.
      return entry && r.is_sample && !r.added_in_demo ? { ...entry, is_sample: true } : entry;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const filtered = filterIndex(entries, q);
  return {
    outcomes: filtered,
    total: filtered.length,
    total_unfiltered: entries.length,
    // Filter options come from what is actually present, so a process type
    // added later appears the first time one of its briefs publishes.
    filters: { source_types: availableSourceTypes(entries), years: availableYears(entries) },
  };
}

/** GET /briefs — the public outcomes index. */
export const handleListBriefs = route(async (req, res) => {
  res.json(await listOutcomes(parseOutcomesQuery(req.query)));
});
