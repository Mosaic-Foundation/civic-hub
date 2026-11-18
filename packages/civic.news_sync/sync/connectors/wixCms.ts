// civic.news_sync — the "wix-cms" connector: a Wix site's blog RSS feed
//
// A Wix site exposes /blog-feed.xml as a structured RSS 2.0 feed with title,
// link, pubDate, and (sometimes) description per item. Floyd County's site was
// the first one read this way, and it is why this connector exists. We use the
// feed instead of scraping the /news listing because:
//   - It's structured XML — no Claude needed for discovery (faster + free).
//   - It exposes more posts than the listing page (19 vs 3 on Floyd's).
//   - Real publication dates instead of relative "X days ago" strings.
//   - When authors include a description, we get it directly.
//
// Wix does NOT include post body content in RSS — only ~25% of items
// have any description text at all. The other ~75% are
// title-and-permalink only. The card UI handles this gracefully:
// when body is empty the card just renders title + pill + timestamp.
//
// Nothing here names a site. The hub's `plugin.news_sync.source_url` is the
// feed; the post permalinks it accepts are Wix's `/post/<slug>` shape on THAT
// feed's origin, so a feed can never smuggle in links to somebody else's site.

import * as cheerio from "cheerio";
import type { NewsConnector, NewsEntry } from "../models.js";

/**
 * Parse a Wix blog RSS 2.0 document into NewsEntry objects.
 *
 * `siteOrigin` is the origin of the configured feed (e.g.
 * "https://www.example.gov"); an item whose link is not a Wix post on that
 * origin is dropped. Skips malformed items but doesn't throw on unrecognized
 * fields. The caller is responsible for filtering by date.
 */
export function parseRssFeed(rawXml: string, siteOrigin: string): NewsEntry[] {
  const $ = cheerio.load(rawXml, { xmlMode: true });
  const entries: NewsEntry[] = [];
  const shareUrlPattern = wixPostUrlPattern(siteOrigin);

  $("item").each((_i, el) => {
    const $item = $(el);
    const title = ($item.find("title").first().text() ?? "").trim();
    const link = ($item.find("link").first().text() ?? "").trim();
    const description = ($item.find("description").first().text() ?? "").trim();
    const pubDateText = ($item.find("pubDate").first().text() ?? "").trim();

    if (title.length === 0 || link.length === 0) return;
    if (!shareUrlPattern.test(link)) return;

    const event_date = parseEventDate(title, link);
    const pub_date_iso = parseRfc822ToIso(pubDateText);

    entries.push({
      title: decodeEntities(title),
      share_url: link,
      // Wix RSS sometimes wraps the description in CDATA with HTML
      // formatting; cheerio's text() unwraps both. Strip residual tags
      // defensively in case the description contains inline HTML.
      body: stripHtml(description),
      event_date,
      pub_date_iso,
    });
  });

  return entries;
}

/**
 * A Wix blog post permalink on this origin: `<origin>/post/<slug>`.
 *
 * Exported for tests. The origin is escaped, so a dot in a hostname matches
 * only a dot.
 */
export function wixPostUrlPattern(siteOrigin: string): RegExp {
  const escaped = siteOrigin.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^${escaped}/post/[A-Za-z0-9_-]+$`);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Try to extract an event date from the title or URL slug.
 *
 * Title forms we recognize:
 *   "Board of Supervisors Meeting 04/28/2026" → 2026-04-28
 *   "Christmas Parade December 14 2025" → 2025-12-14
 *   "April 21st Update"                → null (year not specified)
 *
 * URL slug forms:
 *   "board-of-supervisors-meeting-04-28-2026" → 2026-04-28
 *
 * Returns null when no date with a year can be confidently extracted.
 * The date filter treats null as "include" (open-ended posts like
 * burn bans and bid solicitations).
 */
export function parseEventDate(title: string, url: string): string | null {
  // MM/DD/YYYY in the title
  const slashMatch = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, mm, dd, yyyy] = slashMatch;
    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    if (ISO_DATE_PATTERN.test(iso) && isValidDate(iso)) return iso;
  }

  // MM-DD-YYYY in URL slug (after the pattern Wix uses for date suffix)
  const slugMatch = url.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:[/?#]|$)/);
  if (slugMatch) {
    const [, mm, dd, yyyy] = slugMatch;
    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    if (ISO_DATE_PATTERN.test(iso) && isValidDate(iso)) return iso;
  }

  // Don't try harder. "April 21st Update" without a year would tempt a
  // year guess, but those guesses cause stale items to be incorrectly
  // included or future items to be incorrectly excluded.
  return null;
}

/**
 * Validate ISO date string represents a real calendar date (not 02-30 etc.).
 */
function isValidDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * Convert an RFC 822 / 2822 date (RSS pubDate format) to ISO 8601 UTC.
 * "Sat, 25 Apr 2026 01:41:59 GMT" → "2026-04-25T01:41:59.000Z"
 *
 * Returns null on parse failure (the caller falls back to ingestion time).
 */
export function parseRfc822ToIso(rfc822: string): string | null {
  if (!rfc822) return null;
  const ms = Date.parse(rfc822);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Decode HTML entities (named and numeric) in a string. Cheerio's
 * xmlMode doesn't auto-decode entities in text nodes, so RSS titles
 * like "Public Hearing &#38; Board" come through with raw entities.
 */
function decodeEntities(s: string): string {
  if (!s) return "";
  return s
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Defensive HTML strip — Wix descriptions sometimes include inline
 * markup (`<br/>`, `<p>`, etc.) even when the displayed content is
 * plain text. Removes tags, decodes entities, and collapses whitespace.
 */
function stripHtml(s: string): string {
  if (!s) return "";
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter helper — does this entry's event_date qualify for ingestion?
 *
 *   - event_date === null → INCLUDE (open-ended announcement)
 *   - event_date >= today  → INCLUDE (today or future)
 *   - event_date <  today  → EXCLUDE (past event)
 *
 * `today_iso` is passed in (not read from `new Date()`) so the
 * controller can stamp a single "now" for an entire run.
 */
export function isFutureOrUndated(
  entry: NewsEntry,
  today_iso: string,
): boolean {
  if (entry.event_date === null) return true;
  return entry.event_date >= today_iso;
}

export const wixCmsNewsConnector: NewsConnector = {
  id: "wix-cms",
  description:
    "The blog RSS feed of a Wix-hosted site (…/blog-feed.xml). Structured " +
    "XML, no model call; accepts only /post/ permalinks on the feed's own origin.",

  async discover(cfg, deps) {
    let siteOrigin: string;
    try {
      siteOrigin = new URL(cfg.source_url).origin;
    } catch {
      throw new Error(`plugin.news_sync.source_url="${cfg.source_url}" is not a valid URL.`);
    }
    const rawXml = await deps.fetchText(cfg.source_url);
    console.log(
      `[news-sync] fetched feed url=${cfg.source_url} bytes=${rawXml.length}`,
    );
    return parseRssFeed(rawXml, siteOrigin);
  },
};
