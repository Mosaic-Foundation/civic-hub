// Supabase adapter for civic.process_links.
//
// The module (src/modules/civic.process_links) never imports Supabase; this
// file is the seam between its pure functions and the process_links table,
// mirroring how searchExecutor.ts serves civic.search.
//
// Nothing here enumerates process types. Peers are hydrated straight from the
// processes table and routed through the registry's detailPath resolver, so a
// process type registered tomorrow is linkable and renders correctly today.

import { getDb } from "../db/client.js";
import { generateId } from "../utils/id.js";
import { processDetailPath } from "../processes/registry.js";
import { isPubliclyFetchable } from "./processLifecycle.js";
import {
  renderLinks,
  type LinkPeer,
  type LinkProposal,
  type ProcessLinkEdge,
  type RenderedLinks,
} from "../modules/civic.process_links/index.js";

interface ProcessLinkRow {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  created_by: string | null;
  created_at: string;
}

/** Every edge touching this process, in either direction. Two indexed lookups
 *  rather than an OR, so both use their index. */
export async function getEdgesFor(processId: string): Promise<ProcessLinkEdge[]> {
  const db = getDb();
  const [out, inc] = await Promise.all([
    db.from("process_links").select("*").eq("from_id", processId),
    db.from("process_links").select("*").eq("to_id", processId),
  ]);
  if (out.error) throw new Error(`process_links read failed: ${out.error.message}`);
  if (inc.error) throw new Error(`process_links read failed: ${inc.error.message}`);

  const rows = [...(out.data ?? []), ...(inc.data ?? [])] as ProcessLinkRow[];
  // The two queries can't overlap (the schema forbids self-links), but dedupe
  // on id anyway so a stray row can't render twice.
  const byId = new Map<string, ProcessLinkEdge>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      from_id: r.from_id,
      to_id: r.to_id,
      relation: r.relation as ProcessLinkEdge["relation"],
      created_by: r.created_by,
      created_at: r.created_at,
    });
  }
  return [...byId.values()];
}

/**
 * Hydrate the peers on the far end of a set of edges.
 *
 * `viewerOwnsProcess` relaxes the visibility rule for the one case where it
 * should be relaxed: a creator looking at their own pending submission needs
 * to see the links they just proposed. Everyone else gets only peers that are
 * publicly visible, which is what keeps proposed links private until an admin
 * approves them.
 */
export async function hydratePeers(
  peerIds: string[],
  opts: { includeNonPublicOwnedBy?: string | null; isAdmin?: boolean } = {},
): Promise<Map<string, LinkPeer>> {
  const ids = [...new Set(peerIds)];
  if (ids.length === 0) return new Map();

  const { data, error } = await getDb()
    .from("processes")
    .select("id, type, title, status, created_by, state")
    .in("id", ids);
  if (error) throw new Error(`peer hydration failed: ${error.message}`);

  const map = new Map<string, LinkPeer>();
  for (const row of (data ?? []) as Array<{
    id: string;
    type: string;
    title: string | null;
    status: string;
    created_by: string | null;
    state: Record<string, unknown> | null;
  }>) {
    const moderation = (row.state as { moderation?: { removed?: unknown } } | null)?.moderation;
    if (moderation?.removed === true || moderation?.removed === "true") continue;

    const visible =
      isPubliclyFetchable(row.status as never) ||
      opts.isAdmin === true ||
      (opts.includeNonPublicOwnedBy != null &&
        row.created_by === opts.includeNonPublicOwnedBy);
    if (!visible) continue;

    map.set(row.id, {
      id: row.id,
      type: row.type,
      title: row.title?.trim() || "(untitled)",
      status: row.status,
      href: processDetailPath(row.type, row.id),
    });
  }
  return map;
}

/** Read + render both directions for one process. */
export async function getRenderedLinks(
  processId: string,
  opts: { viewerId?: string | null; isAdmin?: boolean } = {},
): Promise<RenderedLinks> {
  const edges = await getEdgesFor(processId);
  if (edges.length === 0) return { outgoing: [], incoming: [] };

  const peerIds = edges.map((e) => (e.from_id === processId ? e.to_id : e.from_id));
  const peers = await hydratePeers(peerIds, {
    includeNonPublicOwnedBy: opts.viewerId ?? null,
    isAdmin: opts.isAdmin,
  });
  return renderLinks(processId, edges, peers);
}

/** Does this process exist, and who created it? Used for authz and for
 *  refusing a link to a target that isn't there. */
export async function getProcessOwner(
  processId: string,
): Promise<{ id: string; created_by: string | null; status: string; title: string; type: string } | null> {
  const { data, error } = await getDb()
    .from("processes")
    .select("id, created_by, status, title, type")
    .eq("id", processId)
    .maybeSingle();
  if (error) throw new Error(`process lookup failed: ${error.message}`);
  return (data as never) ?? null;
}

/**
 * Store one edge. Idempotent: re-asserting an existing edge returns the row
 * already there instead of erroring, because "make sure these two are linked"
 * is the caller's actual intent.
 */
export async function createEdge(
  fromId: string,
  link: LinkProposal,
  createdBy: string | null,
): Promise<ProcessLinkEdge> {
  const row = {
    id: generateId("plink"),
    from_id: fromId,
    to_id: link.to_id,
    relation: link.relation,
    created_by: createdBy,
  };

  const { data, error } = await getDb()
    .from("process_links")
    .insert(row)
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation on idx_process_links_edge.
    if ((error as { code?: string }).code === "23505") {
      const existing = await getDb()
        .from("process_links")
        .select("*")
        .eq("from_id", fromId)
        .eq("to_id", link.to_id)
        .eq("relation", link.relation)
        .single();
      if (existing.data) return existing.data as ProcessLinkEdge;
    }
    throw new Error(`Failed to create link: ${error.message}`);
  }
  return data as ProcessLinkEdge;
}

/** Store a set of edges (the submission path). Best-effort per edge so one
 *  bad target can't sink an otherwise-valid submission. */
export async function createEdges(
  fromId: string,
  links: LinkProposal[],
  createdBy: string | null,
): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;
  for (const link of links) {
    try {
      await createEdge(fromId, link, createdBy);
      created += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[process_links] could not link ${fromId} -> ${link.to_id} (${link.relation}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return { created, failed };
}

export async function getEdgeById(linkId: string): Promise<ProcessLinkEdge | null> {
  const { data, error } = await getDb()
    .from("process_links")
    .select("*")
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw new Error(`link lookup failed: ${error.message}`);
  return (data as ProcessLinkEdge) ?? null;
}

export async function deleteEdge(linkId: string): Promise<void> {
  const { error } = await getDb().from("process_links").delete().eq("id", linkId);
  if (error) throw new Error(`Failed to remove link: ${error.message}`);
}
