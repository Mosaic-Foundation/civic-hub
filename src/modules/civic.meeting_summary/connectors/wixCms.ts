// Wix CMS connector — reads the collection behind a Wix-hosted meetings page.
//
// WHY THIS EXISTS
// Wix sites increasingly render their content in the browser rather than on
// the server. Floyd County's agendas-and-minutes page did exactly that in
// 2026: `fetch()` returns a 550KB bootstrap shell containing zero meeting
// links, while a real browser shows the full listing. HTML scraping cannot
// read such a page, and no amount of model capability substitutes for the
// content simply not being in the response.
//
// But the data is reachable. A Wix site publishes a read token at
// /_api/v1/access-tokens, and that token queries the CMS collection the page
// displays. That is strictly better than scraping even when the page IS
// server-rendered:
//   - Structured fields, so discovery costs zero model tokens and cannot
//     drift the way prompt-driven extraction can.
//   - The full collection (297 rows for Floyd, back to 2017) rather than
//     whatever a page happens to paginate into view.
//   - Meeting TYPE as its own field, so excluding another body's meetings is
//     an exact match instead of a guess about a title string.
//
// STABILITY, HONESTLY
// This is an internal Wix endpoint, not a documented public API, so it can
// change without notice. Two things make that survivable rather than
// alarming: the cron's empty-discovery guard turns a break into a same-day
// alert instead of months of silence, and the youtube-channel connector
// remains a working fallback for the recordings.
//
// GENERALIZING
// The specific endpoints here are Wix's. The SHAPE is not: "find the
// structured source behind the page, prefer it over the rendered page" is the
// pattern every platform connector should follow. Adding CivicPlus, Granicus,
// or a WordPress REST site is a sibling of this file and touches nothing else.

import type {
  CallClaudeFn,
  FetchHtmlFn,
  FetchJsonFn,
  FetchXmlFn,
  MeetingEntry,
  MeetingSourceConnector,
  MeetingSummaryConfig,
} from "../models.js";
import { matchesTitleFilter } from "./youtubeChannel.js";

/** Wix serves compiled page structure from this host. */
const PAGE_JSON_HOST = "https://pages.parastorage.com/sites";
/** One request returns the whole collection for any realistic meetings table. */
const PAGE_SIZE = 500;
/** Defensive ceiling so a pathological collection cannot loop forever. */
const MAX_PAGES = 10;

// --- Row shape -------------------------------------------------------------

/**
 * One row of a Wix meetings collection, as Floyd's is shaped.
 *
 * Wix names a link's LABEL and its URL as sibling fields, with the URL taking
 * a "1" suffix — `description`/`agendaPdf`, `minutes`/`minutesPdf`,
 * `recording`/`recording1`, `recording2`/`recording21`. Only the URL halves
 * matter here. Everything is optional because a row for an upcoming meeting
 * legitimately has an agenda and nothing else.
 */
export interface WixMeetingRow {
  /** Display date, e.g. "August 11, 2026". Present on every Floyd row. */
  title1?: unknown;
  /** Meeting type, e.g. "Regular Meeting" / "Budget Workshop Meeting". */
  title?: unknown;
  agendaPdf?: unknown;
  minutesPdf?: unknown;
  recording1?: unknown;
  recording21?: unknown;
  recording31?: unknown;
  year1?: unknown;
  month?: unknown;
  _id?: unknown;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Parse Wix's display date into an ISO date.
 *
 * Accepts "August 11, 2026", "Aug 11 2026", and "8/11/2026". Returns null on
 * anything else so the caller can drop the row rather than invent a date —
 * a wrong meeting_date silently misfiles a summary and breaks dedupe.
 */
export function parseWixMeetingDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const named = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (named) {
    const idx = MONTHS.findIndex((m) => m.startsWith(named[1].toLowerCase().slice(0, 3)));
    if (idx >= 0) return iso(Number(named[3]), idx + 1, Number(named[2]));
  }

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return iso(Number(slash[3]), Number(slash[1]), Number(slash[2]));

  const isoish = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoish) return iso(Number(isoish[1]), Number(isoish[2]), Number(isoish[3]));

  return null;
}

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Turn a Wix document reference into a fetchable https URL.
 *
 * Two shapes coexist in a long-lived collection — Floyd's carries both:
 *   wix:document://v1/ugd/{bucket}_{hash}.pdf/{display name}
 *     → {siteOrigin}/_files/ugd/{bucket}_{hash}.pdf
 *   https://{metaSiteId}.filesusr.com/ugd/{bucket}_{hash}.pdf
 *     → already absolute, used verbatim
 *
 * Returns null for anything unrecognized rather than guessing a URL that
 * would 404 halfway through the run.
 */
export function normalizeWixDocUrl(raw: unknown, siteOrigin: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;

  const m = s.match(/^wix:document:\/\/v1\/(ugd\/[^/]+)/i);
  if (m) return `${siteOrigin}/_files/${m[1]}`;

  return null;
}

function asUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * FNV-1a, 32-bit, as 8 hex characters. Deterministic and dependency-free —
 * used only to disambiguate colliding meeting keys, never for security.
 */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** True when the title matches any comma-separated needle. Empty list = no match. */
function matchesAny(title: string, list: string): boolean {
  const needles = (list ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return false;
  const hay = title.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

/**
 * Map collection rows to meeting entries.
 *
 * Exported so it can be tested against a captured collection with no network.
 * Two meetings on the same date are two entries, not one: Floyd routinely
 * holds a Budget Workshop and a Regular Meeting on the same day, and they are
 * separate meetings with separate documents. `source_id` therefore carries
 * both date and type.
 */
export function rowsToMeetings(
  rows: WixMeetingRow[],
  opts: {
    site_origin: string;
    collection: string;
    title_filter: string;
    type_exclude: string;
  },
): MeetingEntry[] {
  const entries: MeetingEntry[] = [];
  // base key -> entries sharing it, so collisions can be disambiguated after
  // the full pass (a collision is only knowable once every row is mapped).
  const byKey = new Map<string, MeetingEntry[]>();
  const fingerprints = new WeakMap<MeetingEntry, string>();

  for (const row of rows) {
    const meeting_date = parseWixMeetingDate(row.title1);
    if (!meeting_date) continue;

    const meeting_title = String(row.title ?? "").trim() || "Meeting";
    if (!matchesTitleFilter(meeting_title, opts.title_filter)) continue;
    if (matchesAny(meeting_title, opts.type_exclude)) continue;

    const source_minutes_url = normalizeWixDocUrl(row.minutesPdf, opts.site_origin);
    const source_agenda_url = normalizeWixDocUrl(row.agendaPdf, opts.site_origin);
    const source_video_url = asUrl(row.recording1);
    const additional_video_urls = [row.recording21, row.recording31]
      .map(asUrl)
      .filter((u): u is string => u !== null);

    // A row with no document and no recording is an announcement of a future
    // meeting, not a record of a past one. Nothing to summarize yet.
    if (!source_minutes_url && !source_agenda_url && !source_video_url) continue;

    const entry: MeetingEntry = {
      meeting_title,
      meeting_date,
      source_minutes_url,
      source_agenda_url,
      source_video_url,
      additional_video_urls,
      // Keyed on the meeting, not the row id: Wix row ids are not stable
      // across a CMS re-import, and two meetings on one date must not
      // collapse into each other.
      source_id: `wix:${opts.collection}:${meeting_date}:${slug(meeting_title)}`,
    };
    // Identity of the row's own content, used only to break ties below. The
    // agenda is preferred because it is published first and changes least.
    fingerprints.set(
      entry,
      source_agenda_url ?? source_minutes_url ?? source_video_url ?? String(row._id ?? ""),
    );
    entries.push(entry);
    const bucket = byKey.get(entry.source_id);
    if (bucket) bucket.push(entry);
    else byKey.set(entry.source_id, [entry]);
  }

  // Disambiguate genuine same-day, same-type meetings.
  //
  // Floyd held two separate Budget Workshop Meetings on 2023-04-11, each with
  // its own agenda and its own recording. Date plus meeting type does not
  // separate them, and letting them share a source_id would mean one silently
  // shadowing the other — the same class of bug as keying dedupe on date
  // alone. Suffixing with a hash of the row's own documents keeps the id
  // stable across runs (it does not depend on query order) while making
  // distinct meetings distinct.
  for (const [key, bucket] of byKey) {
    if (bucket.length < 2) continue;
    for (const entry of bucket) {
      entry.source_id = `${key}:${shortHash(fingerprints.get(entry) ?? "")}`;
    }
  }

  return entries;
}

// --- Collection discovery --------------------------------------------------

/**
 * Find the CMS collection a Wix page displays.
 *
 * The page HTML maps each route to a compiled page-structure file; that file
 * names the collection its dataset reads. Both hops are plain GETs.
 *
 * Returns null rather than throwing so the caller can emit one actionable
 * error telling the operator to set the collection explicitly.
 */
export async function discoverCollectionName(
  pageUrl: string,
  deps: { fetchHtml: FetchHtmlFn; fetchJson: FetchJsonFn },
): Promise<string | null> {
  const html = await deps.fetchHtml(pageUrl);

  const slugOfPath =
    new URL(pageUrl).pathname.replace(/^\/+|\/+$/g, "") || "home";

  // The route's own entry names its page-structure file. A site has one such
  // entry per page, so anchor on this page's slug rather than taking the first.
  const scoped = new RegExp(
    `"${slugOfPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*,\\s*"pageJsonFileName"\\s*:\\s*"([^"]+)"`,
  );
  const fileName =
    html.match(scoped)?.[1] ??
    // Single-page fallback: if the site has exactly one, it is unambiguous.
    (html.match(/"pageJsonFileName"\s*:\s*"([^"]+)"/g)?.length === 1
      ? html.match(/"pageJsonFileName"\s*:\s*"([^"]+)"/)?.[1]
      : undefined);

  if (!fileName) return null;

  const pageJson = await deps.fetchHtml(`${PAGE_JSON_HOST}/${fileName}.json.z?v=3`);
  return pageJson.match(/"collectionName\\?"\s*:\s*\\?"([^"\\]+)/)?.[1] ?? null;
}

/**
 * Ask the site for a read token. Wix returns one per installed app; the data
 * API accepts any of them, so we take the first rather than depending on a
 * particular app id remaining present.
 */
export async function fetchWixAccessToken(
  siteOrigin: string,
  deps: { fetchJson: FetchJsonFn },
): Promise<string> {
  const body = (await deps.fetchJson(`${siteOrigin}/_api/v1/access-tokens`)) as {
    apps?: Record<string, { instance?: string }>;
  };
  for (const app of Object.values(body.apps ?? {})) {
    if (typeof app?.instance === "string" && app.instance.length > 0) {
      return app.instance;
    }
  }
  throw new Error(
    `${siteOrigin}/_api/v1/access-tokens returned no app instance token — ` +
      `this site may not be Wix-hosted, or Wix changed the endpoint.`,
  );
}

/** Page through a collection until it is exhausted. */
export async function queryWixCollection(
  siteOrigin: string,
  collection: string,
  token: string,
  deps: { fetchJson: FetchJsonFn },
): Promise<WixMeetingRow[]> {
  const url = `${siteOrigin}/_api/cloud-data/v1/wix-data/collections/query`;
  const rows: WixMeetingRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await deps.fetchJson(url, {
      method: "POST",
      headers: { authorization: token },
      body: JSON.stringify({
        collectionName: collection,
        query: { paging: { offset: page * PAGE_SIZE, limit: PAGE_SIZE } },
      }),
    })) as { items?: WixMeetingRow[]; totalCount?: number };

    const items = Array.isArray(res.items) ? res.items : [];
    rows.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (typeof res.totalCount === "number" && rows.length >= res.totalCount) break;
  }

  return rows;
}

export const wixCmsConnector: MeetingSourceConnector = {
  id: "wix-cms",
  description:
    "The CMS collection behind a Wix-hosted agendas-and-minutes page. Reads " +
    "structured rows (date, meeting type, agenda PDF, minutes PDF, recordings) " +
    "over HTTP, so it works even when the page renders client-side. No model " +
    "call, no browser.",

  async discover(
    cfg: MeetingSummaryConfig,
    deps: {
      fetchHtml: FetchHtmlFn;
      fetchXml: FetchXmlFn;
      fetchJson: FetchJsonFn;
      callClaude: CallClaudeFn;
    },
  ): Promise<MeetingEntry[]> {
    const pageUrl = (cfg.source_url ?? "").trim();
    if (!pageUrl) {
      throw new Error(
        "MEETING_SOURCE_URL must be set for the wix-cms connector — point it at " +
          "the jurisdiction's agendas-and-minutes page.",
      );
    }

    let siteOrigin: string;
    try {
      siteOrigin = new URL(pageUrl).origin;
    } catch {
      throw new Error(`MEETING_SOURCE_URL="${pageUrl}" is not a valid URL.`);
    }

    let collection = (cfg.collection_name ?? "").trim();
    if (!collection) {
      const found = await discoverCollectionName(pageUrl, deps);
      if (!found) {
        throw new Error(
          `Could not determine which CMS collection ${pageUrl} displays. Set ` +
            `MEETING_WIX_COLLECTION explicitly (open the page, view source, and ` +
            `search for "collectionName"), or use a different MEETING_CONNECTOR_ID.`,
        );
      }
      collection = found;
      console.log(`[meeting-summary] discovered wix collection "${collection}"`);
    }

    const token = await fetchWixAccessToken(siteOrigin, deps);
    const rows = await queryWixCollection(siteOrigin, collection, token, deps);
    console.log(
      `[meeting-summary] wix collection "${collection}": ${rows.length} row(s)`,
    );

    const entries = rowsToMeetings(rows, {
      site_origin: siteOrigin,
      collection,
      title_filter: (cfg.title_filter ?? "").trim(),
      type_exclude: (cfg.type_exclude ?? "").trim(),
    });
    console.log(
      `[meeting-summary] ${entries.length} meeting(s) after filters ` +
        `(include="${cfg.title_filter ?? ""}" exclude="${cfg.type_exclude ?? ""}")`,
    );

    if (rows.length > 0 && entries.length === 0) {
      console.warn(
        `[meeting-summary] collection "${collection}" had ${rows.length} row(s) but ` +
          `none survived filtering. Check MEETING_TITLE_FILTER / MEETING_TYPE_EXCLUDE ` +
          `against the collection's actual meeting-type values.`,
      );
    }

    return entries;
  },
};
