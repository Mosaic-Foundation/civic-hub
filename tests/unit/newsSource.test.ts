// How a post News Sync copies in is shown: its labels (packages/civic.news_sync/
// models.ts) and the cards News Sync and Announcements build from an event's
// payload (their feed.ts; out of the kernel's classifier, kernel step 3).
import { describe, expect, it } from "vitest";
import { newsFromLabel, newsFromNow, newsPillLabel } from "../../packages/civic.news_sync/models.js";
import { newsCard } from "../../packages/civic.news_sync/feed.js";
import { announcementCard } from "../../packages/civic.announcement/feed.js";
import { FEED_SURFACES } from "../../src/shared/feedActivity.js";

describe("news source", () => {
  it("names the pill with the setting, else News", () => {
    expect(newsPillLabel("County news")).toBe("County news");
    expect(newsPillLabel("  Government announcement ")).toBe("Government announcement");
    expect(newsPillLabel("")).toBe("News");
    expect(newsPillLabel("   ")).toBe("News");
    expect(newsPillLabel(undefined)).toBe("News");
    expect(newsPillLabel(null)).toBe("News");
  });

  it("labels posts with the setting, else the place's government", () => {
    expect(newsFromLabel("Floyd County", "Floyd County")).toBe("Floyd County");
    expect(newsFromLabel("  ", "Floyd County")).toBe("Floyd County Government");
    expect(newsFromLabel(undefined, null)).toBe("Local Government");
  });

  it("names a synced post by the hub's From label as set now, even one synced earlier", () => {
    expect(newsFromNow("Parks Department", "Old County Government")).toBe("Parks Department");
    expect(newsFromNow("  New label ", "Old label")).toBe("New label");
  });

  it("falls back to what the post says when the From label is empty", () => {
    expect(newsFromNow("", "Old label")).toBe("Old label");
    expect(newsFromNow("   ", "Old label")).toBe("Old label");
    expect(newsFromNow(null, "Old County Government")).toBe("Old County Government");
    expect(newsFromNow(undefined, "Old label")).toBe("Old label");
  });
});

describe("cards built from the payload", () => {
  it("a News item wears its source's pill and From line, and opens the original", () => {
    expect(newsCard({ news: { source: { label: " Floyd County ", pill: "County news" } } }, "https://x.test/a")).toEqual({
      surface: "news", kind: "news", color: "news", pill: "County news", from: "Floyd County", href: "https://x.test/a",
    });
    expect(newsCard({ news: {} }, "u")).toEqual({ surface: "news", kind: "news", color: "news", pill: "News", href: "u" });
  });

  it("an announcement's pill is its author's role, shortened", () => {
    expect(announcementCard({ announcement: { author_role: "admin" } }, "/a").pill).toBe("Admin");
    expect(announcementCard({ announcement: { author_role: "board" } }, "/a")).toMatchObject({ kind: "announcement-author", pill: "Board member" });
    expect(announcementCard({ announcement: { author_role: "Floyd County Government" } }, "/a").pill).toBe("Floyd County Gov");
  });

  it("an announcement synced before the split reads as News, never urgent or pinned", () => {
    const card = announcementCard({ announcement: { author_role: "admin", source: { origin: "news-sync", label: " Floyd ", urgent: true, pinned: true } } }, "/a");
    expect(card).toEqual({ surface: "news", kind: "news", color: "news", pill: "News", from: "Floyd", href: "/a" });
    expect(announcementCard({ announcement: { source: { origin: "news-sync" } } }, "/a").from).toBe("Admin");
  });

  it("the feed's surfaces are the ones the types name, then the kernel's activity", () => {
    expect(FEED_SURFACES[FEED_SURFACES.length - 1]).toBe("activity");
    expect(FEED_SURFACES).toEqual(expect.arrayContaining(["announcement", "news", "meeting_summary"]));
  });
});
