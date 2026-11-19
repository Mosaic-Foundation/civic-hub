// The space type's palette (kernel step 3, Nov 19): the Civic Hub's colour
// families, card kinds and digest sections moved out of the kernel's feed,
// theme and digest. These pin the orders and values it had in the kernel, so
// the move changes nothing on screen or in the email.

import { describe, expect, it } from "vitest";
import { SPACE_KINDS, SPACE_PALETTE } from "../../src/shared/spacePalette.js";
import { DEFAULT_THEME_COLORS, THEME_TYPE_KEYS, resolveTheme, themeTypeLabel } from "../../src/shared/theme.js";
import { FEED_META_KINDS } from "../../src/shared/feedActivity.js";

describe("the Civic Hub's palette", () => {
  it("keeps Settings → Theme's families, labels and hues in their order", () => {
    expect(THEME_TYPE_KEYS.slice(0, 9)).toEqual([
      "vote", "proposal", "conversation", "project", "announcement", "news", "meeting", "brief", "wordcloud",
    ]);
    expect(themeTypeLabel("meeting")).toBe("Meeting summaries");
    expect(themeTypeLabel("brief")).toBe("Civic briefs");
    expect(DEFAULT_THEME_COLORS.types.vote).toBe("#15294c");
    expect(DEFAULT_THEME_COLORS.types.news).toBe("#34495a");
  });

  it("keeps the digest's section order, with the results last", () => {
    expect(SPACE_PALETTE.sections.map((s) => s.key)).toEqual([
      "votes_open", "vote_results", "meeting_summaries", "announcements", "news", "word_clouds",
      "proposals", "projects", "conversations", "briefs",
    ]);
    expect(SPACE_PALETTE.sections.filter((s) => s.last).map((s) => s.key)).toEqual(["briefs"]);
    expect(SPACE_PALETTE.fallbackSection).toBe("announcements");
  });

  it("keeps each kind's section, order, metadata and note", () => {
    expect(SPACE_KINDS.get("vote-closed")).toMatchObject({ section: "vote_results", order: 1, note: "Results" });
    expect(SPACE_KINDS.get("news")).toMatchObject({ section: "news", order: 4 });
    expect(SPACE_KINDS.get("brief-response")).toMatchObject({ section: "briefs", order: 13, context: true });
    expect([...FEED_META_KINDS].sort()).toEqual(
      [
        "vote-open", "vote-closed", "vote-results", "meeting", "wordcloud", "project-created", "project-updated",
        "conversation", "conversation-results", "announcement", "announcement-author", "news", "brief",
      ].sort(),
    );
  });

  it("still lets votes follow primary, and announcements and briefs follow accent", () => {
    const t = resolveTheme({ primary: "#225588", accent: "#aa5522" });
    expect(t.effective.types.vote).not.toBe("#15294c");
    expect(t.effective.types.announcement).not.toBe("#6e3013");
    expect(t.effective.types.brief).toBe(t.effective.types.announcement);
    expect(t.effective.types.proposal).toBe("#5f4b8b");
    const picked = resolveTheme({ types: { brief: "#6e3013", proposal: "#5f4b8b" } });
    expect(picked.vars["--type-brief-rule"]).toBeDefined();
    expect(picked.vars["--pill-proposal-fg"]).toBeDefined();
    expect(picked.vars["--pill-vote-fg"]).toBeUndefined();
  });
});
