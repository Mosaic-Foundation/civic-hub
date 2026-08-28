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
import { getDb } from "../db/client.js";
import type { CivicEvent } from "../models/event.js";

export interface FeedProcessMeta {
  title?: string;
  description?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  totalVotes?: number;
  commentsCount?: number;
  editCount?: number;
  lastEditedAt?: string | null;
  blockCount?: number;
  maxStartSeconds?: number | null;
  /** Announcement removed by a moderator — the client drops the card. */
  removed?: boolean;
}

/** Kinds whose card reads anything beyond its own event payload —
 *  mirrors the client's per-kind lookup switch in Feed.tsx. */
const META_KINDS: ReadonlySet<ActivityKind> = new Set([
  "vote-open",
  "vote-results",
  "meeting",
  "wordcloud",
  "project-created",
  "project-updated",
  "conversation",
  "conversation-results",
  "announcement",
  "announcement-author",
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
  const wordcloudIds: string[] = [];

  await Promise.all(
    ids.map(async (id) => {
      try {
        // Same read path as GET /process/:id/state (no actor: the feed is
        // a public projection, per-actor fields must not be baked into a
        // shared response). Returns undefined for non-processes and
        // anything not publicly fetchable.
        const model = await getProcessState(id);
        if (!model) return;
        const meta = mapModelToMeta(model);
        if (!meta) return;
        out[id] = meta;
        if (model.type === "civic.wordcloud") wordcloudIds.push(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.warn(`[feed-meta] ${id}: ${msg}`);
      }
    }),
  );

  // Wordcloud read models carry no submission count (the wordcloud
  // controller computes it separately) — one head-count per wordcloud,
  // and there is rarely more than one on a feed.
  await Promise.all(
    wordcloudIds.map(async (id) => {
      const { count, error } = await getDb()
        .from("wordcloud_submissions")
        .select("id", { count: "exact", head: true })
        .eq("process_id", id);
      if (!error) out[id]!.totalVotes = count ?? 0;
    }),
  );

  return out;
}

// --- Per-type mapping -------------------------------------------------------
//
// Tolerant field reads over each handler's public read model — the same
// extractions the client made from the per-id endpoints, moved server-side.

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function mapModelToMeta(
  model: Record<string, unknown>,
): FeedProcessMeta | null {
  switch (model.type) {
    case "civic.vote":
      return {
        title: str(model.title),
        description: str(model.description),
        totalVotes: num(model.total_votes) ?? 0,
      };

    case "civic.vote_results": {
      const comments = model.comments;
      return {
        title: str(model.title),
        description: str(model.admin_notes),
        imageUrl: str(model.image_url) ?? null,
        imageAlt: str(model.image_alt) ?? null,
        totalVotes: num(model.participation_count) ?? 0,
        commentsCount: Array.isArray(comments) ? comments.length : 0,
      };
    }

    case "civic.meeting_summary": {
      const blocks = Array.isArray(model.blocks) ? model.blocks : [];
      const starts = blocks
        .map((b) => num((b as { start_time_seconds?: unknown }).start_time_seconds))
        .filter((n): n is number => n !== undefined);
      return {
        title: str(model.meeting_title),
        blockCount: blocks.length,
        maxStartSeconds: starts.length > 0 ? Math.max(...starts) : null,
      };
    }

    case "civic.wordcloud":
      // totalVotes (submission count) filled by the caller's count query.
      return {
        title: str(model.title),
        description: str(model.description),
      };

    case "civic.project":
      return {
        title: str(model.title),
        description: str(model.description),
        imageUrl: str(model.banner_image_url) ?? null,
        imageAlt: str(model.banner_image_alt) ?? null,
      };

    case "civic.polis_deliberation":
      // Conversations expose their subject as topic/framing.
      return {
        title: str(model.title) ?? str(model.topic),
        description: str(model.description) ?? str(model.framing),
      };

    case "civic.announcement": {
      const moderation = model.moderation as { removed?: unknown } | null;
      return {
        title: str(model.title),
        description: str(model.body),
        imageUrl: str(model.image_url) ?? null,
        imageAlt: str(model.image_alt) ?? null,
        editCount: num(model.edit_count) ?? 0,
        lastEditedAt: str(model.last_edited_at) ?? null,
        removed: moderation?.removed === true,
      };
    }

    default:
      return null;
  }
}
