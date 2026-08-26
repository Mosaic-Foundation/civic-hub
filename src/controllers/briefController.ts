// Brief controller — public read endpoint for published civic.brief
// records (the universal, permanent public record of a completed process).
//
// Only publication_status = "published" records are returned; pending and
// approved records 404 so they stay invisible until an admin publishes.

import { Request, Response } from "express";
import { getProcess } from "../services/processService.js";
import { getDb } from "../db/client.js";
import {
  availableSourceTypes,
  availableYears,
  filterIndex,
  getPublicReadModel,
  toIndexEntry,
  type BriefProcessState,
} from "../modules/civic.brief/index.js";

export async function handleGetBrief(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const process = await getProcess(id);
    if (!process || process.definition.type !== "civic.brief") {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    const model = getPublicReadModel(
      process.state as unknown as BriefProcessState,
      { id: process.id, title: process.title, createdAt: process.createdAt },
    );
    if (!model) {
      // Pending or approved-but-not-published — invisible to the public.
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    res.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}


/**
 * GET /briefs — the public outcomes index.
 *
 * Every published brief, newest first. Filtering and sorting happen in the
 * pure module (civic.brief/filterIndex) rather than in SQL, deliberately: the
 * set is small — one row per completed process, for the life of the hub — and
 * a hub with tens of thousands of outcomes has bigger problems than this
 * query. Keeping it pure means the whole behaviour of the page is testable
 * without a database, which is the layer CI actually runs.
 */
export async function handleListBriefs(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { data, error } = await getDb()
      .from("processes")
      .select("id, title, state")
      .eq("type", "civic.brief")
      .eq("state->>publication_status", "published");
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{
      id: string;
      title: string | null;
      state: Record<string, unknown>;
    }>;

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
    const relatedCounts = await countRelatedFor(sourceIds);

    const entries = rows
      .map((r) => {
        const sourceId = (r.state as { source_process_id?: unknown }).source_process_id;
        return toIndexEntry(
          r.state as unknown as BriefProcessState,
          { id: r.id, title: r.title ?? "(untitled)" },
          typeof sourceId === "string" ? (relatedCounts.get(sourceId) ?? 0) : 0,
        );
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    // Filter options come from what is actually present, so a process type
    // added later appears the first time one of its briefs publishes.
    const sourceTypes = availableSourceTypes(entries);
    const years = availableYears(entries);

    const typeParam = req.query.source_type;
    const requested = (Array.isArray(typeParam) ? typeParam : [typeParam])
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    const yearRaw = typeof req.query.year === "string" ? Number(req.query.year) : NaN;
    const sort = req.query.sort === "oldest" ? "oldest" : "newest";

    const filtered = filterIndex(entries, {
      sourceTypes: requested,
      year: Number.isFinite(yearRaw) ? yearRaw : null,
      sort,
    });

    res.json({
      outcomes: filtered,
      total: filtered.length,
      total_unfiltered: entries.length,
      filters: { source_types: sourceTypes, years },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/** How many links touch each of these processes, in either direction. */
async function countRelatedFor(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const db = getDb();
  const [out, inc] = await Promise.all([
    db.from("process_links").select("from_id").in("from_id", ids),
    db.from("process_links").select("to_id").in("to_id", ids),
  ]);
  for (const r of (out.data ?? []) as Array<{ from_id: string }>) {
    counts.set(r.from_id, (counts.get(r.from_id) ?? 0) + 1);
  }
  for (const r of (inc.data ?? []) as Array<{ to_id: string }>) {
    counts.set(r.to_id, (counts.get(r.to_id) ?? 0) + 1);
  }
  return counts;
}
