// civic.news: a post News Sync copied in from another site's news feed
// (Adam, 2026-11-18: News Sync is its own plugin, apart from Announcements).
//
// A News item is published the moment the job saves it and is never edited.
// It says where it came from (`source`): the original's permalink, which the
// feed card opens, the "From" label and the pill the hub gave its source.
//
// Items synced before the split were announcements and were relabelled News
// by the migration 20261118180000: their state keeps the announcement's
// shape (`content`, `author_role`), so every field here reads both.

/** Where a News item came from. */
export interface NewsSource {
  /** "news-sync" (older rows carry the module's earlier, place-named value). */
  origin: string;
  /** The connector that read it, e.g. "wix-cms". Absent on the oldest rows. */
  connector?: string;
  /** The original's permalink: the card opens it, and it is the dedupe key. */
  share_url: string;
  /** ISO 8601: when the job copied it in. */
  ingested_at: string;
  /** "From …" as the hub named its source when this was copied in. */
  label?: string;
  /** The pill as the hub named its source when this was copied in ("News"). */
  pill?: string;
}

export interface NewsContent {
  title: string;
  /** The feed's description, else a strict paraphrase of the title, else empty. */
  body: string;
}

export interface NewsProcessState {
  type: "civic.news";
  content: NewsContent;
  source: NewsSource;
  /** ISO 8601. */
  created_at: string;
  /** On items relabelled from announcements only: the label they were given then. */
  author_role?: string;
  // Pins are the hub's own (process_pins), not part of the item.
}

/** First N characters of the body in the event's payload. */
export const BODY_PREVIEW_LEN = 200;
export const TITLE_MAX = 300;
export const BODY_MAX = 5000;

/** The pill when a hub names none. */
export const DEFAULT_NEWS_PILL = "News";

/**
 * The "From" label a hub's posts are copied in with: its setting
 * (plugin.news_sync.from_label), else "<place> Government", what synced posts
 * have always been labelled, else "Local Government" where the hub serves no
 * place.
 */
export function newsFromLabel(setting: string | null | undefined, place: string | null | undefined): string {
  const own = setting?.trim();
  if (own) return own;
  return place ? `${place} Government` : "Local Government";
}

/** The pill a hub's posts are copied in with: its setting (plugin.news_sync.pill_label), else "News". */
export function newsPillLabel(setting: string | null | undefined): string {
  return setting?.trim() || DEFAULT_NEWS_PILL;
}

/**
 * Who a News item is from, as its card and page say it: the hub's From label
 * as set now, else what the item itself says. Each hub has one source, so the
 * setting names every item, including ones copied in before a change.
 */
export function newsFromNow(currentSetting: string | null | undefined, itemFrom: string): string {
  return currentSetting?.trim() || itemFrom;
}
