// The Search plugin's call (features/search/routes.ts): one page of hits from
// the kernel's index.

import { request } from "../../../ui/src/services/http";

export type SearchTypeKey =
  | "vote"
  | "vote_results"
  | "announcement"
  | "meeting_summary";

export type SearchSort = "relevance" | "newest";

export interface SearchHit {
  process_id: string;
  type: string;
  title: string;
  description: string;
  created_at: string;
  status: string;
  rank: number;
  href: string;
}

export interface SearchResultPage {
  hits: SearchHit[];
  total: number;
  query: {
    q: string;
    types?: SearchTypeKey[];
    from?: string;
    to?: string;
    sort?: SearchSort;
    limit?: number;
    offset?: number;
  };
  took_ms: number;
}

export interface SearchParams {
  q: string;
  types?: SearchTypeKey[];
  from?: string;
  to?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

/**
 * Run a full-text search across all post types. Always resolves; an
 * empty `q` short-circuits server-side and returns total: 0 without a
 * DB hit.
 */
export function search(params: SearchParams): Promise<SearchResultPage> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.types && params.types.length > 0) {
    for (const t of params.types) sp.append("type", t);
  }
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.sort) sp.set("sort", params.sort);
  if (typeof params.limit === "number") sp.set("limit", String(params.limit));
  if (typeof params.offset === "number") sp.set("offset", String(params.offset));
  return request("GET", `/search?${sp.toString()}`);
}
