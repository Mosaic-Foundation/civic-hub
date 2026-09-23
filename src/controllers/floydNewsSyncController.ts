// civic.floyd_news_sync controller — POST /internal/floyd-news-sync/run
//
// Cron-triggered (and manually triggerable with the same CRON_SECRET).
// Discovers new news posts from Floyd's Wix RSS feed, filters out
// past-dated events, dedupes against already-ingested rows, and creates
// one civic.announcement per new entry (auto-published, no admin
// review). Per-entry failures are isolated; one bad post does not
// abort the run.
//
// Per Slice 13 design: synced announcements have `state.source` set so
// the event emitter routes the action_url to the external permalink.
// The feed-card click goes directly to floydcova.gov, not the internal
// /announcement/:id page. Per Slice 13.1 redesign: no thumbnails (Wix
// document scans are unreadable), body comes from the RSS description
// when present (otherwise empty), no Claude usage on this path.

// TODO(phase2): this runs from a cron with no hub in scope, so the reads
// below resolve from env rather than per hub. Phase 2 makes crons iterate
// hubs and run once per hub.

import { Request, Response } from "express";
import {
  discoverNewsEntries,
  paraphraseTitle,
  type FloydNewsEntry,
  type FloydNewsSyncConfig,
} from "../modules/civic.floyd_news_sync/index.js";
import {
  createProcess,
  getAllProcesses,
  saveProcessState,
} from "../services/processService.js";
import { emitEvent } from "../events/eventEmitter.js";
import { fetchXml } from "../utils/http.js";
import { callClaude, DEFAULT_MODEL } from "../utils/anthropic.js";
import {
  emitAnnouncementResultPublished,
  type AnnouncementProcessContext,
  type AnnouncementProcessState,
  type AnnouncementSource,
} from "../modules/civic.announcement/index.js";
import { getSettingSync, isPluginEnabledSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";

const DEFAULT_SOURCE_URL = "https://www.floydcova.gov/blog-feed.xml";
const DEFAULT_MAX_PER_RUN = 5;
const CRON_ACTOR = "system:floyd-news-sync-cron";
const SYNCED_AUTHOR_ROLE = "Floyd County Government";

function requireCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  return token.length > 0 && token === secret;
}

function enabled(): boolean {
  // Default: enabled. Operator opts out via plugin.news_sync.enabled=false.
  return isPluginEnabledSync("news_sync");
}

function maxPerRun(): number {
  const raw = getSettingSync(KEYS.PLUGIN_NEWS_SYNC_MAX_PER_RUN)?.trim();
  if (!raw) return DEFAULT_MAX_PER_RUN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PER_RUN;
  return Math.floor(n);
}

function sourceUrl(): string {
  return getSettingSync(KEYS.PLUGIN_NEWS_SYNC_SOURCE_URL)?.trim() || DEFAULT_SOURCE_URL;
}

function modelName(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

function todayIsoLocal(): string {
  // Server-local YYYY-MM-DD. Vercel runs in UTC; for a Virginia
  // jurisdiction this can drift by ±1 day at the day boundary but
  // doesn't materially affect the filter.
  return new Date().toISOString().slice(0, 10);
}

function announcementState(record: { state: Record<string, unknown> }): AnnouncementProcessState {
  return record.state as unknown as AnnouncementProcessState;
}

/**
 * Build the set of share_urls already ingested as civic.announcement
 * rows. Used for dedupe — one announcement per share_url, ever.
 */
async function existingShareUrls(): Promise<Set<string>> {
  const all = await getAllProcesses();
  const out = new Set<string>();
  for (const p of all) {
    if (p.definition.type !== "civic.announcement") continue;
    const state = announcementState(p);
    const url = state?.source?.share_url;
    if (typeof url === "string" && url.length > 0) {
      out.add(url);
    }
  }
  return out;
}

export async function handleRunFloydNewsSync(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireCronSecret(req)) {
    res.status(401).json({ error: "Invalid or missing cron credential" });
    return;
  }

  if (!enabled()) {
    res.status(200).json({ skipped: true, reason: "floyd-news-sync disabled" });
    return;
  }

  const cfg: FloydNewsSyncConfig = {
    source_url: sourceUrl(),
  };

  const started = Date.now();
  const today = todayIsoLocal();
  let discovered = 0;
  let created = 0;
  let skippedExisting = 0;
  let failed = 0;

  try {
    console.log(
      `[floyd-news-sync] run started source=${cfg.source_url} today=${today}`,
    );

    const entries: FloydNewsEntry[] = await discoverNewsEntries(
      cfg,
      { fetchText: fetchXml },
      today,
    );
    discovered = entries.length;

    const existing = await existingShareUrls();
    const cap = maxPerRun();
    console.log(
      `[floyd-news-sync] processing — discovered=${discovered} existing=${existing.size} per_run_cap=${cap}`,
    );

    for (const entry of entries) {
      if (created >= cap) {
        console.log(
          `[floyd-news-sync] cap reached (${cap}); remaining new entries deferred to next run`,
        );
        break;
      }
      if (existing.has(entry.share_url)) {
        skippedExisting += 1;
        continue;
      }

      const entryStart = Date.now();
      try {
        const source: AnnouncementSource = {
          origin: "floyd-news",
          share_url: entry.share_url,
          ingested_at: new Date().toISOString(),
        };

        // When the RSS description is empty (~75% of Floyd's posts),
        // ask Claude for a strict paraphrase of the title (and event
        // date if present). The prompt is locked to forbid invented
        // specifics — see paraphrase.ts. A Claude failure is
        // non-fatal: we fall back to an empty body and log a warning.
        let body = entry.body;
        if (!body) {
          if (!process.env.ANTHROPIC_API_KEY) {
            console.warn(
              `[floyd-news-sync] no body and ANTHROPIC_API_KEY unset — skipping paraphrase for ${entry.share_url}`,
            );
          } else {
            try {
              body = await paraphraseTitle(
                { title: entry.title, event_date: entry.event_date },
                { callClaude, model: modelName() },
              );
              console.log(
                `[floyd-news-sync] paraphrased share_url=${entry.share_url} → "${body.slice(0, 80)}${body.length > 80 ? "…" : ""}"`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : "unknown error";
              console.warn(
                `[floyd-news-sync] paraphrase failed for ${entry.share_url}: ${msg} — falling back to empty body`,
              );
            }
          }
        }

        const record = await createProcess({
          definition: { type: "civic.announcement", version: "0.1" },
          title: entry.title,
          // Body is RSS description verbatim when present, else a
          // strict Claude paraphrase of the title, else empty.
          description: body,
          jurisdiction: "us-va-floyd",
          createdBy: CRON_ACTOR,
          // Note: we do NOT pass eventTimestamp here. Newly-synced
          // posts come in within a day of Floyd publishing them, so
          // pubDate ≈ now anyway, and backdating new events would
          // push them outside the digest's 24h window. The eventTimestamp
          // override remains available on createProcess for one-off
          // backfills / migrations that need it.
          state: {
            title: entry.title,
            body,
            author_id: CRON_ACTOR,
            author_role: SYNCED_AUTHOR_ROLE,
            links: [],
            // Slice 13.1: no thumbnails for synced announcements.
            // Wix's document-scan thumbnails are unreadable noise;
            // cards look better without them.
            image_url: null,
            image_alt: null,
            source,
          },
        });

        const state = announcementState(record);
        const ctx: AnnouncementProcessContext = {
          process_id: record.id,
          hub_id: record.hubId,
          jurisdiction: record.jurisdiction,
          emit: emitEvent,
        };
        await emitAnnouncementResultPublished(ctx, CRON_ACTOR, state);

        record.status = "finalized";
        await saveProcessState(record);

        console.log(
          `[floyd-news-sync] created process=${record.id} share_url=${entry.share_url} body_len=${body.length} body_source=${entry.body ? "rss" : body ? "paraphrase" : "empty"} duration_ms=${Date.now() - entryStart}`,
        );
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.warn(
          `[floyd-news-sync] failed share_url=${entry.share_url} error=${msg} duration_ms=${Date.now() - entryStart}`,
        );
        failed += 1;
      }
    }

    const duration_ms = Date.now() - started;
    console.log(
      `[floyd-news-sync] run complete discovered=${discovered} created=${created} skipped_existing=${skippedExisting} failed=${failed} duration_ms=${duration_ms}`,
    );
    res.status(200).json({
      discovered,
      created,
      skipped_existing: skippedExisting,
      failed,
      duration_ms,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[floyd-news-sync] run failed:", err);
    res.status(500).json({ error: msg });
  }
}
