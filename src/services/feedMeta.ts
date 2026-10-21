// Feed enrichment — the per-process card metadata, batched server-side.
//
// Perf pass, phase 2 (2026-08-28). Phase 1 let feed cards paint from the
// event payload and hydrate their second line (summary text, engagement
// counts, images) from per-process follow-up fetches — which put a
// visible pop-in on every card. This module moves that second wave to
// the server: GET /feed classifies its own events, runs the SAME handler
// read models the per-id endpoints serve (via getProcessState, so the
// visibility gate and every type's field logic are reused, not
// duplicated), and ships a `process_meta` map alongside the events. The
// client seeds its metadata cache from it and makes no follow-up
// requests at all.
//
// Field names are the CLIENT's ProcessMeta camelCase (Feed.tsx), on
// purpose — this map exists solely to seed that cache; converting to
// snake_case here and back on the client would be two chances to typo.
//
// Failure posture: enrichment is best-effort. A process that errors (or
// isn't a process at all — resident proposals) is simply absent from the
// map, and the client's lazy per-id fallback still exists for that case.

import {
  classifyActivity,
  type ActivityKind,
  type ClassifierEvent,
} from "../shared/feedActivity.js";
import { getProcessState } from "./processService.js";
import { getProcessHandler } from "../processes/registry.js";
import type { CivicEvent } from "../models/event.js";

export type { FeedProcessMeta } from "../processes/contracts/feedMeta.js";
import type { FeedProcessMeta } from "../processes/contracts/feedMeta.js";

/** Kinds whose card reads anything beyond its own event payload —
 *  mirrors the client's per-kind lookup switch in Feed.tsx. */
const META_KINDS: ReadonlySet<ActivityKind> = new Set([
  "vote-open",
  "vote-closed",
  "vote-results",
  "meeting",
  "wordcloud",
  "project-created",
  "project-updated",
  "conversation",
  "conversation-results",
  "announcement",
  "announcement-author",
  // A brief's card is its publish event; a regenerated version replaces its
  // headline in place, marked "Updated <date>" (Actions slice).
  "brief",
] as ActivityKind[]);

export async function buildFeedProcessMeta(
  events: CivicEvent[],
): Promise<Record<string, FeedProcessMeta>> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.process_id || seen.has(e.process_id)) continue;
    const activity = classifyActivity(e as unknown as ClassifierEvent);
    if (!activity || !META_KINDS.has(activity.kind)) continue;
    seen.add(e.process_id);
    ids.push(e.process_id);
  }

  const out: Record<string, FeedProcessMeta> = {};

  await Promise.all(
    ids.map(async (id) => {
      try {
        // Same read path as GET /process/:id/state (no actor, audience
        // "public": the feed meta is a shared cross-audience projection —
        // per-actor fields and resident names must not be baked into it.
        // The types' feedMeta hooks carry no creator fields either way).
        // Returns undefined for non-processes and anything not publicly
        // fetchable.
        const model = await getProcessState(id, { audience: "public" });
        if (!model) return;
        // Each type's handler maps its own read model (feedMeta); a type
        // without the hook has no feed meta.
        const meta = await getProcessHandler(String(model.type))?.feedMeta?.(model, id);
        if (!meta) return;
        out[id] = meta;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.warn(`[feed-meta] ${id}: ${msg}`);
      }
    }),
  );

  return out;
}
