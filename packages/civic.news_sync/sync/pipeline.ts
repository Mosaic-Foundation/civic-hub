// civic.news_sync — orchestration pipeline
//
// Resolves the hub's connector, fetches and parses its feed, and filters by
// date. Returns the list of entries the controller should consider ingesting
// (further deduped by share_url against existing rows).
//
// No Claude usage on this path — feeds are structured. Faster, free, and
// removes a hallucination surface area.

import type { DiscoverDeps, NewsEntry, NewsSyncConfig } from "./models.js";
import { isFutureOrUndated } from "./connectors/wixCms.js";
import { newsConnectorFor } from "./connectors/index.js";

/**
 * Fetch + parse + date-filter. Returns entries ready for dedupe and
 * ingestion. Logs run-shape metrics (valid count, future-or-undated count) so
 * the Vercel logs read as a clear summary even when nothing is created.
 *
 * Throws on an unknown connector: the config resolver refuses one before a
 * run starts, so reaching here with one is a programming error.
 */
export async function discoverNewsEntries(
  cfg: NewsSyncConfig,
  deps: DiscoverDeps,
  today_iso: string,
): Promise<NewsEntry[]> {
  const connector = newsConnectorFor(cfg.connector);
  if (!connector) throw new Error(`Unknown news-sync connector "${cfg.connector}"`);

  const parsed = await connector.discover(cfg, deps);
  const future = parsed.filter((e) => isFutureOrUndated(e, today_iso));

  console.log(
    `[news-sync] connector=${connector.id} parsed ${parsed.length} valid entries, ${future.length} future-or-undated (filtered out ${parsed.length - future.length} past-date)`,
  );

  return future;
}
