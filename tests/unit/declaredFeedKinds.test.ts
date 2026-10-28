// A package's own card kind (engine 2, A5): declared in its manifest's
// `feed.kinds`, read by the theme, the feed's stylesheet and the digest, named
// in no hub list. The Events plugin's "event" is the first.

import { describe, expect, it } from "vitest";
import { DECLARED_COLORS, DECLARED_FEED_KINDS } from "../../src/shared/feedActivity.js";
import {
  BUILTIN_THEME_TYPE_KEYS,
  DEFAULT_THEME_COLORS,
  THEME_TYPE_KEYS,
  declaredTypeStylesheet,
  themeTypeLabel,
} from "../../src/shared/theme.js";
import { MANIFEST_LIST } from "../../src/shared/processManifests.js";
import { checkManifests } from "../../src/processes/manifest.js";

describe("declared feed kinds", () => {
  it("come from the manifests, with the type that declared them", () => {
    expect(DECLARED_FEED_KINDS.get("event")?.type).toBe("civic.event");
    expect(DECLARED_COLORS.map((c) => c.key)).toContain("event");
  });

  it("join the theme's colour families after the hub's own", () => {
    expect(THEME_TYPE_KEYS.slice(0, BUILTIN_THEME_TYPE_KEYS.length)).toEqual([...BUILTIN_THEME_TYPE_KEYS]);
    expect(THEME_TYPE_KEYS).toContain("event");
    expect(DEFAULT_THEME_COLORS.types.event).toBe("#8a2456");
    expect(themeTypeLabel("event")).toBe("Events");
  });

  it("get their tokens and feed rules from one generated stylesheet", () => {
    const css = declaredTypeStylesheet();
    expect(css).toContain(":root{--type-event-bg:#f6e3ec;--type-event-fg:#8a2456}");
    expect(css).toContain(".feed-pill--type-event{background:var(--type-event-bg);color:var(--type-event-fg)}");
    expect(css).toContain(".feed-post--type-event{border-top-color:var(--type-event-fg)}");
  });

  it("are refused at startup when they clash with the hub's own or name no colour", () => {
    const events = MANIFEST_LIST.find((m) => m.descriptor.type === "civic.event")!;
    const HOST = { colors: [...THEME_TYPE_KEYS], hostActivityTypes: [], hostTables: [], featureIds: [] };
    const clash = { ...events, feed: { ...events.feed!, kinds: [{ ...events.feed!.kinds![0], kind: "meeting" }] } };
    expect(() => checkManifests([clash] as never, HOST as never)).toThrow(/one of the hub's own/);
    const noHex = { ...events, feed: { ...events.feed!, kinds: [{ ...events.feed!.kinds![0], color: { key: "event", fg: "red", bg: "#ffffff", label: "x" } }] } };
    expect(() => checkManifests([noHex] as never, HOST as never)).toThrow(/#rrggbb/);
    const undeclared = { ...events, feed: { cards: events.feed!.cards } };
    expect(() => checkManifests([undeclared] as never, HOST as never)).toThrow(/neither the hub's nor declared/);
  });
});
