// How a post News Sync copies in is shown (src/shared/newsSource.ts).
import { describe, expect, it } from "vitest";
import { newsFromLabel, newsShowAs, syncedFrom, syncedSourceView } from "../../src/shared/newsSource.js";

describe("news source", () => {
  it("reads anything but 'announcement' as News", () => {
    expect(newsShowAs("announcement")).toBe("announcement");
    expect(newsShowAs("news")).toBe("news");
    expect(newsShowAs("")).toBe("news");
    expect(newsShowAs(undefined)).toBe("news");
    expect(newsShowAs("urgent")).toBe("news");
  });

  it("labels posts with the setting, else the place's government", () => {
    expect(newsFromLabel("Floyd County", "Floyd County")).toBe("Floyd County");
    expect(newsFromLabel("  ", "Floyd County")).toBe("Floyd County Government");
    expect(newsFromLabel(undefined, null)).toBe("Local Government");
  });

  it("is null for a post that was not synced", () => {
    expect(syncedSourceView(null)).toBeNull();
    expect(syncedSourceView(undefined)).toBeNull();
  });

  it("reads a synced post's label and show-as, defaulting to News with no label", () => {
    expect(syncedSourceView({ origin: "news-sync" })).toEqual({ label: null, showAs: "news" });
    expect(syncedSourceView({ origin: "news-sync", label: " Floyd County ", show_as: "announcement" })).toEqual({
      label: "Floyd County",
      showAs: "announcement",
    });
  });

  it("never carries urgent or pinned: those are not a source's to set", () => {
    const view = syncedSourceView({ origin: "news-sync", urgent: true, pinned: true });
    expect(view).toEqual({ label: null, showAs: "news" });
  });

  it("names a synced post by the hub's From label as set now, even one synced earlier", () => {
    expect(syncedFrom("Parks Department", "Old County Government")).toBe("Parks Department");
    expect(syncedFrom("  New label ", "Old label")).toBe("New label");
  });

  it("falls back to what the post says when the From label is empty", () => {
    expect(syncedFrom("", "Old label")).toBe("Old label");
    expect(syncedFrom("   ", "Old label")).toBe("Old label");
    expect(syncedFrom(null, "Old County Government")).toBe("Old County Government");
    expect(syncedFrom(undefined, "Old label")).toBe("Old label");
  });
});
