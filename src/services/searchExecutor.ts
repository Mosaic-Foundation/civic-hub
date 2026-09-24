// Slice 10.5 — concrete RPC executors used by the search controller.
//
// The civic.search module never imports Supabase; this file is the
// adapter between the module's injected callbacks and the actual
// `search_processes` / `search_processes_count` RPC functions defined
// in the migration.
//
// Hub-scoped since Phase 2a: both calls go through forHub().rpc(), which
// passes the hub in scope as p_hub_id, and the functions filter on it
// (20260924050000). One hub's search never returns another hub's processes.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import type {
  SearchCountFn,
  SearchExecuteFn,
  SearchHitRow,
} from "../modules/civic.search/index.js";

interface SearchProcessesRow {
  id: string;
  type: string;
  title: string | null;
  description: string | null;
  status: string;
  state: Record<string, unknown> | null;
  created_at: string;
  rank: number;
}

export const executeSearchRpc: SearchExecuteFn = async (filters) => {
  const { data, error } = await forHub(currentHubId()).rpc("search_processes", {
    p_q: filters.q,
    p_types: filters.internalTypes,
    p_from: filters.from,
    p_to: filters.to,
    p_sort: filters.sort,
    p_limit: filters.limit,
    p_offset: filters.offset,
  });
  if (error) {
    throw new Error(`search RPC failed: ${error.message}`);
  }
  const rows = (data ?? []) as SearchProcessesRow[];
  return rows.map<SearchHitRow>((r) => ({
    id: r.id,
    type: r.type,
    title: r.title ?? "",
    description: r.description ?? "",
    status: r.status,
    state: r.state ?? null,
    created_at: r.created_at,
    rank: typeof r.rank === "number" ? r.rank : Number(r.rank ?? 0),
  }));
};

export const countSearchRpc: SearchCountFn = async (filters) => {
  const { data, error } = await forHub(currentHubId()).rpc("search_processes_count", {
    p_q: filters.q,
    p_types: filters.internalTypes,
    p_from: filters.from,
    p_to: filters.to,
  });
  if (error) {
    throw new Error(`search count RPC failed: ${error.message}`);
  }
  // The RPC returns a bigint that supabase-js surfaces as a string in
  // some configurations and a number in others. Normalize.
  if (typeof data === "number") return data;
  if (typeof data === "string") return parseInt(data, 10) || 0;
  return 0;
};
