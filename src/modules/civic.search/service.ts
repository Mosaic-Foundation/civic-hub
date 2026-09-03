// civic.search — pure validation, formatting, and orchestration.
//
// The host hub injects two callbacks: one runs the search RPC and
// returns hits, the other runs the count RPC. This module never
// imports Supabase, Express, or anything hub-specific.

import { stripMarkdown } from "../../shared/markdown.js";
import type {
  SearchCountFn,
  SearchExecuteFn,
  SearchFilters,
  SearchHit,
  SearchHitRow,
  SearchQuery,
  SearchResultPage,
  SearchSort,
  SearchTypeKey,
} from "./models.js";
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_OFFSET_MAX,
} from "./models.js";

// --- Public-key → internal-type-id mapping ----------------------------------

/** Wire-format keys used in the URL / API map 1:1 onto internal
 *  civic.* type identifiers. Centralizing here keeps the controller
 *  from inlining the mapping (and therefore drifting). */
const TYPE_MAP: Record<SearchTypeKey, string> = {
  vote: "civic.vote",
  vote_results: "civic.vote_results",
  announcement: "civic.announcement",
  meeting_summary: "civic.meeting_summary",
};

const KNOWN_TYPE_KEYS: ReadonlySet<string> = new Set(Object.keys(TYPE_MAP));

// --- Validation -------------------------------------------------------------

/** Coerce raw input into a SearchFilters with all defaults applied.
 *  Throws on bad shape; returns a `null` for q-empty so the caller
 *  can short-circuit without hitting the DB. */
export function validateQuery(input: SearchQuery): SearchFilters | null {
  const q = (input.q ?? "").trim();
  if (q.length === 0) return null;

  let internalTypes: string[] | null = null;
  if (input.types !== undefined) {
    if (!Array.isArray(input.types)) {
      throw new Error("`types` must be an array of strings.");
    }
    const valid = input.types
      .map((t) => String(t))
      .filter((t) => KNOWN_TYPE_KEYS.has(t)) as SearchTypeKey[];
    if (valid.length > 0) {
      internalTypes = valid.map((k) => TYPE_MAP[k]);
    }
  }

  const sort: SearchSort = input.sort === "newest" ? "newest" : "relevance";

  const limitRaw =
    typeof input.limit === "number" ? input.limit : SEARCH_LIMIT_DEFAULT;
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(limitRaw)));

  const offsetRaw = typeof input.offset === "number" ? input.offset : 0;
  const offset = Math.max(0, Math.min(SEARCH_OFFSET_MAX, Math.floor(offsetRaw)));

  return {
    q,
    internalTypes,
    from: normalizeIso(input.from ?? null),
    to: normalizeIso(input.to ?? null),
    sort,
    limit,
    offset,
  };
}

function normalizeIso(input: string | null | undefined): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }
  return d.toISOString();
}

// --- Hit formatting ---------------------------------------------------------

/** Map an internal civic.* type to the canonical UI route for its detail
 *  page. Injected by the caller rather than switched on here: the registry
 *  owns the type -> route mapping (ProcessHandler.detailPath), so a newly
 *  registered process type routes correctly with no change to this module —
 *  and this module stays free of any hub-specific type list.
 *
 *  Defaults to the generic process route, which resolves for every type. */
export type HrefResolver = (type: string, id: string) => string;

const defaultHref: HrefResolver = (_type, id) => `/process/${id}`;

/** Trim a description for card display. Falls back to a short slice
 *  of the body when description is empty / null. */
function cardSummary(row: SearchHitRow): string {
  if (row.description && row.description.trim().length > 0) {
    return stripMarkdown(row.description).trim();
  }
  // Fallback: peek into common state shapes for body / admin_notes /
  // meeting first-block summary. Cheap and best-effort; the row's
  // description is set by the controller in most cases anyway.
  const state = row.state ?? {};
  const content = (state as { content?: { body?: unknown; admin_notes?: unknown } }).content;
  if (content && typeof content.body === "string") return content.body.trim();
  if (content && typeof content.admin_notes === "string" && content.admin_notes.trim().length > 0) {
    return content.admin_notes.trim();
  }
  return "";
}

export function formatHit(row: SearchHitRow, hrefFor: HrefResolver = defaultHref): SearchHit {
  return {
    process_id: row.id,
    type: row.type,
    title: row.title || "(untitled)",
    description: cardSummary(row),
    created_at: row.created_at,
    status: row.status,
    rank: row.rank,
    href: hrefFor(row.type, row.id),
  };
}

// --- Top-level orchestrator -------------------------------------------------

export interface SearchDeps {
  execute: SearchExecuteFn;
  count: SearchCountFn;
  /** Resolves a hit's canonical UI path. The host hub passes the registry's
   *  resolver; omitting it falls back to the generic process route. */
  hrefFor?: HrefResolver;
  /** Wall-clock provider — injected so tests can drive deterministic
   *  took_ms values. Defaults to performance.now / Date.now. */
  now?: () => number;
}

/**
 * Run a search end-to-end: validate, dispatch the two RPC calls in
 * parallel, format the hits, return the paginated page. Empty `q`
 * short-circuits with `total: 0` and zero DB calls — the caller is
 * responsible for hitting this path before exposing the search bar
 * on a page.
 */
export async function executeSearch(
  query: SearchQuery,
  deps: SearchDeps,
): Promise<SearchResultPage> {
  const now = deps.now ?? defaultNow;
  const start = now();

  const filters = validateQuery(query);
  if (!filters) {
    return {
      hits: [],
      total: 0,
      query: normalizeQueryEcho(query),
      took_ms: 0,
    };
  }

  const [rows, total] = await Promise.all([
    deps.execute(filters),
    deps.count(filters),
  ]);

  return {
    hits: rows.map((row) => formatHit(row, deps.hrefFor ?? defaultHref)),
    total,
    query: {
      q: filters.q,
      types: query.types,
      from: filters.from ?? undefined,
      to: filters.to ?? undefined,
      sort: filters.sort,
      limit: filters.limit,
      offset: filters.offset,
    },
    took_ms: Math.round(now() - start),
  };
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** Echo the caller's query back unmodified (with empty defaults
 *  applied) for the empty-q branch. */
function normalizeQueryEcho(query: SearchQuery): SearchQuery {
  return {
    q: (query.q ?? "").trim(),
    types: query.types,
    from: query.from ?? undefined,
    to: query.to ?? undefined,
    sort: query.sort ?? "relevance",
    limit: query.limit ?? SEARCH_LIMIT_DEFAULT,
    offset: query.offset ?? 0,
  };
}
