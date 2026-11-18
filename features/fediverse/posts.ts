// What the hub posts, and how a post reads (plan of 2026-11-12, item 2).
//
// WHICH ITEMS. Something opening (a vote, a proposal, a project, a word cloud,
// a conversation, an event, an announcement) and something decided (a vote's
// results, a conversation's outcome, a brief). From the public feed's own
// items (the host's publicActivity: no sample content, nothing that is not
// public), so a post never says more than the hub's own front page.
//
// WHAT A POST SAYS. The item's kind and title, its description as its link
// preview has it (cut with "Read more" when long), its image, a link to its
// page on the hub, and hashtags. Never who started it or who took part, and never numbers: a
// vote's totals are on the hub, after it closes.
//
// HOW OFTEN (plugin.fediverse.post_mode): each item as it happens (the
// default); or a daily or weekly roundup, posted on days with something new,
// listing the first few items and linking to a page on the hub with all of
// them.

import { getSettingSync, type PublicActivityItem } from "../../src/sdk/index.js";
import type { Post, RoundupItem } from "./store.js";

export const POST_MODE_KEY = "plugin.fediverse.post_mode";
export const HASHTAGS_KEY = "plugin.fediverse.hashtags";
export const POST_MODES = ["each", "daily", "weekly"] as const;
export type PostMode = (typeof POST_MODES)[number];

/** How many items a roundup lists before "and N more". */
export const ROUNDUP_SHOWN = 5;
/** The local hour a roundup goes out. */
export const ROUNDUP_HOUR = 8;

/** The opening line of each kind posted: "New vote". Kinds not here are not posted. */
const OPENING: Readonly<Record<string, string>> = {
  "vote-open": "New vote",
  proposal: "New proposal",
  "project-created": "New project",
  wordcloud: "New word cloud",
  conversation: "New conversation",
  announcement: "Announcement",
  "announcement-author": "Announcement",
  news: "News",
  event: "New event",
};
const DECIDED: Readonly<Record<string, string>> = {
  "vote-closed": "Results",
  "vote-results": "Results",
  "conversation-results": "Outcome",
  brief: "Outcome",
};

/** The feed kinds the hub posts. */
export const POSTED_KINDS: ReadonlySet<string> = new Set([...Object.keys(OPENING), ...Object.keys(DECIDED)]);

export function postMode(): PostMode {
  const v = getSettingSync(POST_MODE_KEY)?.trim();
  return (POST_MODES as readonly string[]).includes(v ?? "") ? (v as PostMode) : "each";
}

/** "Results" or "New vote": what a post about this item opens with. */
export function headingFor(item: Pick<PublicActivityItem, "kind" | "pill">): string {
  return OPENING[item.kind] ?? DECIDED[item.kind] ?? item.pill;
}

/** A hashtag from words: "Floyd County" → "FloydCounty". Letters and digits only. */
export function hashtag(words: string): string | null {
  const tag = words
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
  return tag && /[A-Za-z]/.test(tag) && tag.length <= 60 ? tag : null;
}

/**
 * The hub's hashtags: #CivicHub, the hub's name without "Civic Hub"
 * ("Floyd Civic Hub" → #Floyd), and any its admins added
 * (plugin.fediverse.hashtags, comma separated).
 */
export function hubHashtags(hubName: string, extra: string | null = getSettingSync(HASHTAGS_KEY) ?? null): string[] {
  const own = hashtag(hubName.replace(/\bcivic\s+hub\b/i, ""));
  const added = (extra ?? "").split(/[,\n]+/).map((t) => hashtag(t.replace(/^#/, "")));
  return [...new Set(["CivicHub", own, ...added].filter((t): t is string => !!t))].slice(0, 6);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function tagsHtml(tags: readonly string[], origin: string): string {
  return tags
    .map((t) => `<a href="${esc(origin)}/" class="mention hashtag" rel="tag">#<span>${esc(t)}</span></a>`)
    .join(" ");
}

/** A post's text for one item. */
export function itemContent(item: PublicActivityItem, tags: readonly string[], origin: string): string {
  // The description as the item's link preview has it: a couple of
  // sentences, cut with "…" when longer; then "Read more" leads to the rest.
  const description = item.description?.trim() || null;
  const cut = !!description && description.endsWith("…");
  const link = `<a href="${esc(item.url)}">${esc(item.url.replace(/^https?:\/\//, ""))}</a>`;
  return [
    `<p><strong>${esc(headingFor(item))}:</strong> ${esc(item.title)}</p>`,
    description ? `<p>${esc(description)}</p>` : "",
    `<p>${cut ? `Read more: ${link}` : link}</p>`,
    tags.length ? `<p>${tagsHtml(tags, origin)}</p>` : "",
  ].join("");
}

/** A roundup's text: a line per item, the first few, and a link to the whole list. */
export function roundupContent(
  items: readonly RoundupItem[],
  period: "today" | "this week",
  hubName: string,
  pageUrl: string,
  tags: readonly string[],
  origin: string,
): string {
  const shown = items.slice(0, ROUNDUP_SHOWN);
  const more = items.length - shown.length;
  const lines = shown.map((i) => `${esc(i.pill)}: <a href="${esc(i.url)}">${esc(i.title)}</a>`);
  if (more > 0) lines.push(`and ${more} more`);
  const count = items.length === 1 ? "1 new item" : `${items.length} new items`;
  return [
    `<p><strong>${esc(hubName)}, ${period}:</strong> ${count}</p>`,
    `<p>${lines.join("<br>")}</p>`,
    `<p>All of them: <a href="${esc(pageUrl)}">${esc(pageUrl.replace(/^https?:\/\//, ""))}</a></p>`,
    tags.length ? `<p>${tagsHtml(tags, origin)}</p>` : "",
  ].join("");
}

/** A post id: time-ordered, unique enough, and safe in a URL. */
export function newPostId(now: Date): string {
  return `${now.getTime().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** The post for one item. */
export function itemPost(item: PublicActivityItem, tags: readonly string[], origin: string, now: Date): Post {
  return {
    id: newPostId(now),
    kind: "item",
    activity_kind: item.kind,
    event_id: item.event_id,
    process_id: item.process_id,
    url: item.url,
    content: itemContent(item, tags, origin),
    items: null,
    published_at: now.toISOString(),
    process_iri: item.process_iri,
    activity_iri: item.activity_iri,
    image_url: item.image?.url ?? null,
    image_alt: item.image?.alt ?? null,
  };
}

/** Where a roundup's full list is, on the hub. */
export function roundupPageUrl(origin: string, id: string): string {
  return `${origin}/fediverse/roundups/${id}`;
}

/** The post for a roundup of `items`. */
export function roundupPost(
  items: readonly PublicActivityItem[],
  period: "today" | "this week",
  hubName: string,
  tags: readonly string[],
  origin: string,
  now: Date,
): Post {
  const id = newPostId(now);
  const listed: RoundupItem[] = items.map((i) => ({
    title: i.title,
    pill: headingFor(i),
    url: i.url,
    process_iri: i.process_iri,
    activity_iri: i.activity_iri,
  }));
  const url = roundupPageUrl(origin, id);
  return {
    id,
    kind: "roundup",
    activity_kind: null,
    event_id: null,
    process_id: null,
    url,
    content: roundupContent(listed, period, hubName, url, tags, origin),
    items: listed,
    published_at: now.toISOString(),
    process_iri: null,
    activity_iri: null,
    image_url: null,
    image_alt: null,
  };
}

/**
 * Whether a roundup is due at `now` in `timeZone`: at or after ROUNDUP_HOUR,
 * on a day (daily) or a Monday (weekly) with no roundup yet. `last` is the
 * local date of the last one, YYYY-MM-DD.
 */
export function roundupDue(mode: "daily" | "weekly", now: Date, timeZone: string, last: string | null): { due: boolean; today: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour < ROUNDUP_HOUR || last === today) return { due: false, today };
  if (mode === "weekly" && parts.weekday !== "Mon") return { due: false, today };
  return { due: true, today };
}
