// Slice 10.5 — GET /search
//
// Public, unauthenticated. Empty `q` returns an empty result set
// without hitting the DB. Filters: type[], from, to. Sort: relevance
// (default) or newest. Pagination: limit (default 25, max 100) +
// offset.
//
// All actual SQL lives in the search_processes / search_processes_count
// RPC functions defined in the migration. This controller is a thin
// orchestration layer.

import type { Request } from "express";
import { route } from "../http/route.js";
import {
  executeSearch,
  type SearchQuery,
  type SearchSort,
  type SearchTypeKey,
} from "../modules/civic.search/index.js";
import {
  countSearchRpc,
  executeSearchRpc,
} from "../services/searchExecutor.js";
import { processDetailPath } from "../processes/registry.js";

const ALLOWED_TYPES: ReadonlySet<SearchTypeKey> = new Set([
  "vote",
  "vote_results",
  "announcement",
  "meeting_summary",
]);

function readTypes(req: Request): SearchTypeKey[] | undefined {
  const raw = req.query.type;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const out: SearchTypeKey[] = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    if (ALLOWED_TYPES.has(t as SearchTypeKey)) {
      out.push(t as SearchTypeKey);
    }
  }
  return out.length > 0 ? out : undefined;
}

function readSort(req: Request): SearchSort | undefined {
  const raw = req.query.sort;
  if (typeof raw !== "string") return undefined;
  return raw === "newest" ? "newest" : "relevance";
}

function readNumber(req: Request, key: string): number | undefined {
  const raw = req.query[key];
  if (typeof raw !== "string") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function readDate(req: Request, key: string): string | undefined {
  const raw = req.query[key];
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  return raw.trim();
}

export const handleSearch = route(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const query: SearchQuery = {
    q,
    types: readTypes(req),
    from: readDate(req, "from"),
    to: readDate(req, "to"),
    sort: readSort(req),
    limit: readNumber(req, "limit"),
    offset: readNumber(req, "offset"),
  };

  const page = await executeSearch(query, {
    execute: executeSearchRpc,
    count: countSearchRpc,
    hrefFor: processDetailPath,
  });

  // Structured per-request log — useful for spotting slow queries
  // or empty-result patterns without sampling the full request log.
  const safeQ = page.query.q.replace(/"/g, '\\"');
  const typesCount = page.query.types?.length ?? 0;
  console.log(
    `[search] q="${safeQ}" types=${typesCount} hits=${page.hits.length} total=${page.total} took_ms=${page.took_ms}`,
  );

  res.json(page);
});
