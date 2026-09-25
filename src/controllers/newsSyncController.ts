// civic.news_sync — the "news_sync" job (src/jobs/registry.ts).
//
// Run once per active hub by the job runner. For a hub that has configured it, discovers new posts from the hub's
// own news feed through the hub's own connector, filters out past-dated
// events, dedupes against already-ingested rows, and creates one
// civic.announcement per new entry (auto-published, no admin review).
// Per-entry failures are isolated; one bad post does not abort the run, and
// one hub's broken feed does not stop the next hub's.
//
// Renamed from the Floyd news sync on 2026-09-24. The old path is still
// mounted as a deprecated alias (the job's deprecatedPaths in the registry),
// because production's vercel.json on `main` calls it until the cutover.
//
// Per Slice 13 design: synced announcements have `state.source` set so the
// event emitter routes the action_url to the external permalink. The
// feed-card click goes directly to the government's site, not the internal
// /announcement/:id page. Per Slice 13.1 redesign: no thumbnails (Wix
// document scans are unreadable), body comes from the feed's description when
// present, otherwise a strict Claude paraphrase of the title, otherwise empty.
//
import {
  discoverNewsEntries,
  paraphraseTitle,
  resolveNewsSyncConfig,
  type NewsEntry,
  type NewsSyncConfig,
} from "../modules/civic.news_sync/index.js";
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
import { civicPlaceShortName, processJurisdiction } from "../config/hub.js";

const CRON_ACTOR = "system:news-sync-cron";

function modelName(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Who a synced post is shown as written by: the hub's own government, named
 * from its place — "Floyd County Government" for Floyd, which is exactly the
 * label its synced posts have always carried. Derived rather than a setting
 * because the place is already the hub's data (`hubs.jurisdiction_name`); a
 * hub with no civic geography gets the neutral "Local Government".
 */
function syncedAuthorRole(): string {
  const place = civicPlaceShortName();
  return place ? `${place} Government` : "Local Government";
}

function todayIsoLocal(): string {
  // Server-local YYYY-MM-DD. Vercel runs in UTC; for a US jurisdiction
  // this can drift by ±1 day at the day boundary but doesn't materially
  // affect the filter.
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

/** What one hub's run reports. `status` is the HTTP status it would have had alone. */
export interface NewsSyncHubOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * One hub's run, inside that hub's scope. Every value it reads — enabled,
 * connector, feed, cap, jurisdiction, author label, the names in the
 * paraphrase prompt — is the hub in scope's, and there is no default that
 * could stand in for a hub that set nothing.
 */
export async function runNewsSyncForHub(): Promise<NewsSyncHubOutcome> {
  // What news sync makes is announcements; with those off there is nothing
  // it may create, so it does not fetch at all.
  if (!isPluginEnabledSync("announcement")) {
    return { status: 200, body: { skipped: true, reason: "plugin.announcement.enabled is off" } };
  }
  const resolved = resolveNewsSyncConfig();
  if (resolved.status === "skipped") {
    return { status: 200, body: { skipped: true, reason: resolved.reason } };
  }
  if (resolved.status === "invalid") {
    console.error(`[news-sync] not run: ${resolved.reason}`);
    return { status: 500, body: { error: resolved.reason } };
  }

  const cfg: NewsSyncConfig = resolved.cfg;
  const cap = resolved.maxPerRun;
  const names = {
    place: civicPlaceShortName(),
    governing_body: getSettingSync(KEYS.COPY_GOVERNING_BODY_NAME)?.trim() || null,
  };

  const started = Date.now();
  const today = todayIsoLocal();
  let discovered = 0;
  let created = 0;
  let skippedExisting = 0;
  let failed = 0;

  try {
    console.log(
      `[news-sync] run started connector=${cfg.connector} source=${cfg.source_url} today=${today}`,
    );

    const entries: NewsEntry[] = await discoverNewsEntries(
      cfg,
      { fetchText: fetchXml },
      today,
    );
    discovered = entries.length;

    const existing = await existingShareUrls();
    console.log(
      `[news-sync] processing — discovered=${discovered} existing=${existing.size} per_run_cap=${cap}`,
    );

    for (const entry of entries) {
      if (created >= cap) {
        console.log(
          `[news-sync] cap reached (${cap}); remaining new entries deferred to next run`,
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
          origin: "news-sync",
          connector: cfg.connector,
          share_url: entry.share_url,
          ingested_at: new Date().toISOString(),
        };

        // When the feed's description is empty (~75% of Wix posts),
        // ask Claude for a strict paraphrase of the title (and event
        // date if present). The prompt is locked to forbid invented
        // specifics — see paraphrase.ts. A Claude failure is
        // non-fatal: we fall back to an empty body and log a warning.
        let body = entry.body;
        if (!body) {
          if (!process.env.ANTHROPIC_API_KEY) {
            console.warn(
              `[news-sync] no body and ANTHROPIC_API_KEY unset — skipping paraphrase for ${entry.share_url}`,
            );
          } else {
            try {
              body = await paraphraseTitle(
                { title: entry.title, event_date: entry.event_date },
                { callClaude, model: modelName(), names },
              );
              console.log(
                `[news-sync] paraphrased share_url=${entry.share_url} → "${body.slice(0, 80)}${body.length > 80 ? "…" : ""}"`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : "unknown error";
              console.warn(
                `[news-sync] paraphrase failed for ${entry.share_url}: ${msg} — falling back to empty body`,
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
          jurisdiction: processJurisdiction(),
          createdBy: CRON_ACTOR,
          // Note: we do NOT pass eventTimestamp here. Newly-synced
          // posts come in within a day of the site publishing them, so
          // pubDate ≈ now anyway, and backdating new events would
          // push them outside the digest's 24h window. The eventTimestamp
          // override remains available on createProcess for one-off
          // backfills / migrations that need it.
          state: {
            title: entry.title,
            body,
            author_id: CRON_ACTOR,
            author_role: syncedAuthorRole(),
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
          jurisdiction: record.jurisdiction,
          emit: emitEvent,
        };
        await emitAnnouncementResultPublished(ctx, CRON_ACTOR, state);

        record.status = "finalized";
        await saveProcessState(record);

        console.log(
          `[news-sync] created process=${record.id} share_url=${entry.share_url} body_len=${body.length} body_source=${entry.body ? "rss" : body ? "paraphrase" : "empty"} duration_ms=${Date.now() - entryStart}`,
        );
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.warn(
          `[news-sync] failed share_url=${entry.share_url} error=${msg} duration_ms=${Date.now() - entryStart}`,
        );
        failed += 1;
      }
    }

    const duration_ms = Date.now() - started;
    console.log(
      `[news-sync] run complete discovered=${discovered} created=${created} skipped_existing=${skippedExisting} failed=${failed} duration_ms=${duration_ms}`,
    );
    return {
      status: 200,
      body: {
        discovered,
        created,
        skipped_existing: skippedExisting,
        failed,
        duration_ms,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[news-sync] run failed:", err);
    return { status: 500, body: { error: msg } };
  }
}
