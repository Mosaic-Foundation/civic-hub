// YouTube channel connector.
//
// Discovers meetings from a government's YouTube channel feed instead of
// scraping its website.
//
// WHY THIS EXISTS
// The original connector (floydMinutes.ts) fetches a jurisdiction's
// agendas-and-minutes page and asks Claude to read the links out of it.
// That works right up until the jurisdiction redesigns the page. Floyd
// County moved theirs onto a client-rendered Wix component in 2026, and
// `fetch()` — which does not execute JavaScript — started returning a
// 551KB shell containing zero meeting links. Discovery kept "succeeding"
// with zero entries and the pipeline went quiet for weeks.
//
// A channel feed has none of that fragility:
//   - It is a documented, stable endpoint, not a page layout.
//   - It is plain XML. No JavaScript, no rendering, no headless browser.
//   - No API key, and no Claude call — the meeting date is in the title,
//     so discovery costs one HTTP GET instead of a model invocation.
//   - Auto-captions give us a transcript for the summarization leg, which
//     is the source that actually records what happened in the room.
//
// The trade-off is that a channel carries no minutes PDF. That is fine:
// the pipeline already summarizes transcript-first (source_type
// "recording"), and the cron's existing upgrade pass re-summarizes from
// minutes if an HTML connector later finds them for the same date.
//
// LIMITS, STATED PLAINLY
//   - The feed returns only the ~15 most recent videos. Ample for a daily
//     cron against a body that meets twice a month; backfilling older
//     meetings needs the YouTube Data API (YOUTUBE_API_KEY).
//   - A channel carries more than one body's meetings (Floyd's also hosts
//     EMS Board recordings), so `title_filter` is how an operator narrows
//     it to the meetings they publish summaries for.

import * as cheerio from "cheerio";
import type {
  CallClaudeFn,
  FetchHtmlFn,
  FetchXmlFn,
  MeetingEntry,
  MeetingSourceConnector,
  MeetingSummaryConfig,
} from "../models.js";

const FEED_BASE = "https://www.youtube.com/feeds/videos.xml";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

/** Build the Atom feed URL for a channel id. Exported for the diagnostic script. */
export function channelFeedUrl(channelId: string): string {
  const u = new URL(FEED_BASE);
  u.searchParams.set("channel_id", channelId);
  return u.toString();
}

export function isValidChannelId(channelId: string): boolean {
  return CHANNEL_ID_PATTERN.test(channelId.trim());
}

/** One video as it appears in the channel feed, before grouping. */
export interface FeedVideo {
  video_id: string;
  title: string;
  /** ISO 8601 timestamp the video was published to the channel. */
  published: string;
  /** Position in the feed document (0 = first/newest). */
  feed_index: number;
}

/**
 * Parse a YouTube channel Atom feed into videos, newest first.
 *
 * Malformed entries are skipped rather than throwing — one bad row must
 * not cost us the whole run. A feed that yields zero videos is NOT
 * treated as an error here; the cron's discovery guard decides what an
 * empty result means (see handleRunMeetingSummary).
 */
export function parseChannelFeed(rawXml: string): FeedVideo[] {
  const $ = cheerio.load(rawXml, { xmlMode: true });
  const videos: FeedVideo[] = [];

  $("entry").each((i, el) => {
    const $entry = $(el);
    const videoId = ($entry.find("yt\\:videoId").first().text() ?? "").trim();
    const title = ($entry.find("title").first().text() ?? "").trim();
    const published = ($entry.find("published").first().text() ?? "").trim();

    if (!VIDEO_ID_PATTERN.test(videoId)) return;
    if (title.length === 0) return;

    videos.push({
      video_id: videoId,
      title: decodeEntities(title),
      published,
      feed_index: i,
    });
  });

  return videos;
}

/**
 * Extract the meeting's own date from the video title.
 *
 * The title is the authoritative source, not the publish timestamp: a
 * meeting recorded on the 23rd is routinely uploaded on the 24th, and
 * dating the summary by upload time would misfile it.
 *
 * Recognized forms:
 *   "... Regular Meeting 08/11/2026"        → 2026-08-11
 *   "... Meeting 2026-08-11"                → 2026-08-11
 *   "... Meeting August 11, 2026"           → 2026-08-11
 *
 * Returns null when no date carrying an explicit year can be read; the
 * caller then falls back to the publish date.
 */
export function parseMeetingDateFromTitle(title: string): string | null {
  // MM/DD/YYYY (also M/D/YYYY)
  const slash = title.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    return isoDate(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  }

  // YYYY-MM-DD
  const iso = title.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // "August 11, 2026" / "Aug 11 2026"
  const named = title.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase().slice(0, 3)];
    if (month) return isoDate(Number(named[3]), month, Number(named[2]));
  }

  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Strip the date and any multi-part marker out of a video title to get a
 * stable meeting name.
 *
 *   "Floyd County BOS Meeting 04/14/2026 - 3" → "Floyd County BOS Meeting"
 *
 * The result is both the display title and (slugified) half of the dedupe
 * key, so it must not vary between the parts of one meeting.
 */
export function cleanMeetingTitle(title: string): string {
  return title
    // the date, in any of the forms parseMeetingDateFromTitle recognizes
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
      " ",
    )
    // trailing part markers: "- 2", "-2", "Part 2", "(2)"
    .replace(/[\s\-–—]*\bpart\s*\d+\b/gi, " ")
    .replace(/[\s]*[-–—][\s]*\d+\s*$/g, " ")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, "")
    .trim();
}

/**
 * Does this title belong to a body we publish summaries for?
 *
 * `filter` is a comma-separated list of case-insensitive substrings; a
 * title matching ANY of them is kept. An empty filter keeps everything,
 * which is the right default for a channel dedicated to one body.
 */
export function matchesTitleFilter(title: string, filter: string): boolean {
  const needles = (filter ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (needles.length === 0) return true;
  const haystack = title.toLowerCase();
  return needles.some((n) => haystack.includes(n));
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Collapse feed videos into one MeetingEntry per meeting.
 *
 * A single meeting routinely spans several uploads — a stream drops and
 * restarts, or a long session is posted in parts. They share a date and a
 * cleaned title, so that pair is the grouping key. Within a group the
 * earliest upload is the primary recording (the one we transcribe) and
 * the rest become additional_video_urls.
 *
 * Exported separately from discover() so it can be tested against a
 * captured feed without any network.
 */
export function groupVideosIntoMeetings(
  videos: FeedVideo[],
  opts: { channel_id: string; title_filter: string },
): MeetingEntry[] {
  const groups = new Map<string, { title: string; date: string; videos: FeedVideo[] }>();

  for (const v of videos) {
    if (!matchesTitleFilter(v.title, opts.title_filter)) continue;

    const fromTitle = parseMeetingDateFromTitle(v.title);
    // Fall back to the publish date only when the title carries none.
    const date = fromTitle ?? (v.published ? v.published.slice(0, 10) : null);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const title = cleanMeetingTitle(v.title) || v.title;
    const key = `${date}::${slug(title)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.videos.push(v);
    } else {
      groups.set(key, { title, date, videos: [v] });
    }
  }

  const entries: MeetingEntry[] = [];
  for (const [key, g] of groups) {
    // Earliest upload first. The feed is newest-first, so when two parts
    // share a publish timestamp the one appearing LATER in the feed was
    // uploaded first — hence the descending feed_index tiebreak.
    const ordered = [...g.videos].sort((a, b) => {
      const t = a.published.localeCompare(b.published);
      if (t !== 0) return t;
      return b.feed_index - a.feed_index;
    });

    entries.push({
      meeting_title: g.title,
      meeting_date: g.date,
      source_minutes_url: null,
      source_agenda_url: null,
      source_video_url: watchUrl(ordered[0].video_id),
      additional_video_urls: ordered.slice(1).map((v) => watchUrl(v.video_id)),
      // Keyed on the meeting, not the video: a re-upload of the same
      // meeting must not read as a new meeting. Carries the channel so
      // two bodies on different channels can never collide.
      source_id: `youtube:${opts.channel_id}:${key}`,
    });
  }

  return entries;
}

export const youtubeChannelConnector: MeetingSourceConnector = {
  id: "youtube-channel",
  description:
    "A government's YouTube channel feed. Discovers meetings from video titles " +
    "(date included) and uses the auto-transcript as the summarization source. " +
    "No scraping, no JavaScript rendering, no API key.",

  async discover(
    cfg: MeetingSummaryConfig,
    deps: { fetchHtml: FetchHtmlFn; fetchXml: FetchXmlFn; callClaude: CallClaudeFn },
  ): Promise<MeetingEntry[]> {
    const channelId = (cfg.channel_id ?? "").trim();
    if (!channelId) {
      throw new Error(
        "MEETING_YOUTUBE_CHANNEL_ID must be set for the youtube-channel connector " +
          "(e.g. UCxyzO8F2UfiN1NVOax2s27Q — the UC… id, not the @handle).",
      );
    }
    if (!isValidChannelId(channelId)) {
      throw new Error(
        `MEETING_YOUTUBE_CHANNEL_ID="${channelId}" is not a YouTube channel id. ` +
          `Expected a 24-character id starting with "UC". Open the channel, view ` +
          `source, and read the "channelId" value — an @handle will not work here.`,
      );
    }

    const feedUrl = channelFeedUrl(channelId);
    const xml = await deps.fetchXml(feedUrl);
    const videos = parseChannelFeed(xml);
    console.log(
      `[meeting-summary] channel feed ${channelId}: ${videos.length} video(s) in feed`,
    );

    const filter = (cfg.title_filter ?? "").trim();
    const entries = groupVideosIntoMeetings(videos, {
      channel_id: channelId,
      title_filter: filter,
    });
    console.log(
      `[meeting-summary] grouped into ${entries.length} meeting(s)` +
        (filter ? ` matching title filter "${filter}"` : " (no title filter)"),
    );

    // A channel that returned videos but no meetings after filtering is a
    // misconfiguration worth naming, not a quiet zero.
    if (videos.length > 0 && entries.length === 0) {
      console.warn(
        `[meeting-summary] channel feed had ${videos.length} video(s) but none ` +
          `matched MEETING_TITLE_FILTER="${filter}". Check the filter against the ` +
          `channel's actual video titles.`,
      );
    }

    return entries;
  },
};
