// civic.news_sync — type definitions
//
// Pulls a local government's news feed and creates one civic.announcement per
// new post. Auto-published — no admin queue. Click on the synced feed card
// opens the post on the government's own site.
//
// Renamed from civic.floyd_news_sync in Phase 4 of the multi-tenant build
// (2026-09-24). It was written for Floyd County's Wix site and had Floyd's
// feed URL, jurisdiction and author label compiled in; now every one of those
// is the hub's data, and which kind of site a hub has is a CONNECTOR chosen in
// its settings:
//
//   plugin.news_sync.connector    which connector reads the feed ("wix-cms")
//   plugin.news_sync.source_url   the feed it reads
//
// Both empty means the hub does not use news sync, and the cron skips it. There
// are no defaults: a default URL is how one hub's news would end up on another
// hub's feed.
//
// Feeds only sometimes include post body content (Floyd's Wix RSS: ~25% of
// items). When it doesn't, the controller asks Claude for a strict paraphrase
// of the title (paraphrase.ts), else the card renders with an empty body. We
// never invent body text beyond that — civic content shouldn't carry
// hallucinated specifics.
//
// Per slice 13.1 redesign: thumbnails removed entirely (Wix's document-scan
// thumbnails are unreadable noise), and discovery never calls Claude (RSS XML
// is structured).

/**
 * One news entry as parsed from the source feed. The `share_url` is also the
 * dedupe key on subsequent runs — we ingest at most one civic.announcement per
 * share_url ever.
 */
export interface NewsEntry {
  /** Plain-text title from the feed. */
  title: string;
  /**
   * The post's permanent URL. Click on the synced feed card routes here.
   * Each connector validates it against the shape its platform uses, on the
   * configured site's own origin — entries that don't match are dropped
   * during parsing.
   */
  share_url: string;
  /**
   * Plain-text body content, with HTML stripped and whitespace collapsed.
   * Empty string when the feed didn't include one (the common case). The card
   * UI renders an empty-body card cleanly; the hub admin can manually annotate
   * via PATCH /announcement/:id later if desired.
   */
  body: string;
  /**
   * Event date extracted from the title (e.g. "Council Meeting 04/28/2026")
   * or URL slug (e.g. `council-meeting-04-28-2026`). Null when no date with a
   * year can be confidently extracted — those entries are always ingested
   * (open-ended announcements like burn bans, bid solicitations, etc.).
   * ISO 8601 (YYYY-MM-DD).
   */
  event_date: string | null;
  /**
   * Publication date, normalized to ISO 8601 UTC. Null when parsing failed
   * (rare). Cards display "X minutes ago" relative to it.
   */
  pub_date_iso: string | null;
}

/**
 * One hub's news-sync configuration, resolved from its settings.
 *
 * Built by `resolveNewsSyncConfig()` from `plugin.news_sync.*` and nothing
 * else — never from a literal, never from another hub.
 */
export interface NewsSyncConfig {
  /** Registry id of the connector that reads the feed, e.g. "wix-cms". */
  connector: string;
  /** The feed the connector reads. */
  source_url: string;
}

export type FetchTextFn = (url: string) => Promise<string>;

export interface DiscoverDeps {
  /**
   * Fetches the feed body as text. Production wires this up to
   * civic-hub/src/utils/http.ts::fetchXml (a thin wrapper over `fetch` with
   * timeout + user-agent). Tests inject a stub.
   */
  fetchText: FetchTextFn;
}

/**
 * A kind of site a hub's news can come from.
 *
 * Supporting another publishing platform (a WordPress site, CivicPlus, a
 * plain RSS feed) is one new module under ./connectors and one entry in the
 * registry there. Nothing else changes, and no connector may carry a
 * particular hub's URL: it is handed the hub's `source_url` and derives
 * everything site-specific from that.
 */
export interface NewsConnector {
  /** Stable id, stored in `plugin.news_sync.connector`. */
  readonly id: string;
  /** One line for operators: what kind of site this reads. */
  readonly description: string;
  /**
   * Fetch and parse the hub's feed. Returns every valid entry; date filtering
   * is the pipeline's job, not the connector's. Throws when the source cannot
   * be read at all — an unreadable feed is a failure, not an empty one.
   */
  discover(cfg: NewsSyncConfig, deps: DiscoverDeps): Promise<NewsEntry[]>;
}
