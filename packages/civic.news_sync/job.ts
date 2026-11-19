// The "news_sync" job (this package's manifest): discovers new posts from a
// hub's own news feed and creates one News item (civic.news) per new entry.
//
// Runs once per active hub, inside that hub's scope (src/jobs/runJob.ts). For
// a hub that has configured it, discovers posts through the hub's own
// connector, filters out past-dated events, dedupes against already-ingested
// rows, and publishes each new entry as a News item (no admin review).
// Per-entry failures are isolated: one bad post does not abort the run, and
// one hub's broken feed does not stop the next hub's. Returns a JobOutcome:
// 200 with the counts (or a skip reason), 500 with an error when the config
// is invalid or the run throws.
//
// A News item's published event carries the original's permalink as its
// action_url: the feed-card click goes straight to the source's site, not the
// hub's /news/:id page. There are no thumbnails (document scans are
// unreadable); the body comes from the feed's description when present,
// otherwise a strict Claude paraphrase of the title, otherwise empty.
//
// Each item's source also carries the hub's "From" label and pill as they
// were when it was copied in (./state.ts). Nothing marks it
// urgent; an admin can pin it like any item.
//
// News Sync is its own plugin since 2026-11-18: it needs nothing else
// switched on, and Announcements needs nothing of it. Everything it reads of
// the hub comes through the plugin SDK and the adapters it was granted.

import { hubContext, processesOf, settingsOf, type AiSingleTurnInput, type JobOutcome, type JobRunner } from "@civic-social/plugin-sdk";
import {
  discoverNewsEntries,
  paraphraseTitle,
  resolveNewsSyncConfig,
  type NewsEntry,
  type NewsSyncConfig,
} from "./sync/index.js";
import { newsSyncHost } from "./host.js";
import { emitNewsPublished } from "./events.js";
import { newsFromLabel, newsPillLabel } from "./state.js";
import type { NewsSource } from "./models.js";

const ai = () => newsSyncHost.get().adapter("ai");
/** The news sync's model calls, through the ai adapter's gate, as a job. */
const callClaude = (input: AiSingleTurnInput) => ai().complete("job.news_sync", input);
/** The feed, through the hub's fetchers (the grant's `web`). */
const fetchXml = (url: string) => newsSyncHost.get().adapter("web").fetchXml(url);
const ownProcesses = () => processesOf("civic.news");
const setting = (name: string) => settingsOf("news_sync").get(name);

/**
 * Every original's permalink this hub has copied in, whatever the item's
 * status: an archived one stays archived rather than coming back on the next
 * run. Posts synced before News items had their own type were relabelled News
 * by the migration 20261118180000, so its own type is all there is to read.
 */
async function syncedShareUrls(): Promise<Set<string>> {
  const [live, archived] = await Promise.all([ownProcesses().list(), ownProcesses().list({ archived: true })]);
  const urls = new Set<string>();
  for (const p of [...live, ...archived]) {
    const url = (p.state as { source?: { share_url?: unknown } }).source?.share_url;
    if (typeof url === "string" && url) urls.add(url);
  }
  return urls;
}

const CRON_ACTOR = "system:news-sync-cron";

function modelName(): string {
  return ai().defaultModel();
}

/**
 * Who a synced post is shown as from: the hub's "From label" setting, else
 * its own government, named from its place ("Floyd County Government" for
 * Floyd, the label its synced posts have always carried), else the neutral
 * "Local Government" (./state.ts).
 */
function syncedFromLabel(): string {
  return newsFromLabel(setting("from_label"), hubContext().placeName);
}

function todayIsoLocal(): string {
  // Server-local YYYY-MM-DD. Vercel runs in UTC; for a US jurisdiction
  // this can drift by ±1 day at the day boundary but doesn't materially
  // affect the filter.
  return new Date().toISOString().slice(0, 10);
}

/**
 * One hub's run, inside that hub's scope. Every value it reads — enabled,
 * connector, feed, cap, jurisdiction, author label, the names in the
 * paraphrase prompt — is the hub in scope's, and there is no default that
 * could stand in for a hub that set nothing.
 */
export const newsSyncJob: JobRunner = async (): Promise<JobOutcome> => {
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
    place: hubContext().placeName,
    governing_body: settingsOf("news_sync").public("copy.governing_body_name")?.trim() || null,
  };

  // Read once per run: every item this run saves carries the same two.
  const fromLabel = syncedFromLabel();
  const pill = newsPillLabel(setting("pill_label"));

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

    const existing = await syncedShareUrls();
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
        const source: NewsSource = {
          origin: "news-sync",
          connector: cfg.connector,
          share_url: entry.share_url,
          ingested_at: new Date().toISOString(),
          label: fromLabel,
          pill,
        };

        // When the feed's description is empty (~75% of Wix posts),
        // ask Claude for a strict paraphrase of the title (and event
        // date if present). The prompt is locked to forbid invented
        // specifics — see paraphrase.ts. A Claude failure is
        // non-fatal: we fall back to an empty body and log a warning.
        let body = entry.body;
        if (!body) {
          if (!ai().configured()) {
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

        const record = await ownProcesses().create({
          definition: { type: "civic.news", version: "0.1" },
          title: entry.title,
          // Body is RSS description verbatim when present, else a
          // strict Claude paraphrase of the title, else empty.
          description: body,
          createdBy: CRON_ACTOR,
          // Note: we do NOT pass eventTimestamp here. Newly-synced
          // posts come in within a day of the site publishing them, so
          // pubDate ≈ now anyway, and backdating new events would
          // push them outside the digest's 24h window. The eventTimestamp
          // override remains available on createProcess for one-off
          // backfills / migrations that need it.
          // No thumbnails (Slice 13.1): Wix's document-scan thumbnails are
          // unreadable noise; cards look better without them.
          state: { title: entry.title, body, source },
        });

        await emitNewsPublished(record, CRON_ACTOR);

        record.status = "finalized";
        await ownProcesses().saveState(record);

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
};
