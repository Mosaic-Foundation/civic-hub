// The right column's cards setting (src/shared/asideCards.ts; ADR-019): how a
// stored list is read, drawn in order, and written back so a card the hub
// doesn't draw keeps its place; and what the settings endpoint accepts.

import { describe, expect, it } from "vitest";
import { ASIDE_CARD_IDS, orderedAsideCards, parseAsideCards, withOrder } from "../../src/shared/asideCards.js";
import { normalizeValue } from "../../src/models/hubSettingsWrite.js";
import { fieldSpec } from "../../src/shared/hubSettingsSections.js";
import { PUBLIC_KEY_LIST } from "../../src/models/hubSettings.js";

const HUB = [...ASIDE_CARD_IDS];

describe("the right column's cards", () => {
  it("are all shown in the default order when nothing is stored", () => {
    expect(orderedAsideCards(parseAsideCards(undefined), HUB)).toEqual([
      { id: "coming_up", shown: true },
      { id: "announcements", shown: true },
      { id: "about", shown: true },
    ]);
  });

  it("read a stored list, and anything unreadable as the default", () => {
    expect(parseAsideCards('[{"id":"about","shown":false},{"id":"about","shown":true},{"id":3}]')).toEqual([{ id: "about", shown: false }]);
    expect(parseAsideCards("not json")).toEqual([]);
    expect(parseAsideCards('{"id":"about"}')).toEqual([]);
  });

  it("draw the stored order, skip a card the hub doesn't draw, and add a new one at the end, shown", () => {
    const stored = parseAsideCards('[{"id":"about","shown":true},{"id":"plugin_card","shown":true},{"id":"coming_up","shown":false}]');
    expect(orderedAsideCards(stored, HUB)).toEqual([
      { id: "about", shown: true },
      { id: "coming_up", shown: false },
      { id: "announcements", shown: true },
    ]);
  });

  it("keep a card the hub doesn't draw when the order is saved", () => {
    const stored = parseAsideCards('[{"id":"plugin_card","shown":false},{"id":"about","shown":true}]');
    const drawn = [{ id: "coming_up", shown: true }, { id: "about", shown: false }, { id: "announcements", shown: true }];
    expect(withOrder(stored, drawn)).toEqual([...drawn, { id: "plugin_card", shown: false }]);
  });

  it("are one public setting the settings endpoint checks", () => {
    expect(PUBLIC_KEY_LIST).toContain("nav.aside_cards");
    const spec = fieldSpec("nav.aside_cards")!;
    expect(normalizeValue(spec, [{ id: "about", shown: false }])).toBe('[{"id":"about","shown":false}]');
    expect(normalizeValue(spec, "")).toBe("");
    expect(normalizeValue(spec, [])).toBe("");
    for (const bad of ["x", [{ id: "about" }], [{ id: "Bad id", shown: true }], [{ id: "a", shown: true }, { id: "a", shown: true }]]) {
      expect(normalizeValue(spec, bad)).toHaveProperty("error");
    }
    expect(fieldSpec("nav.layout")?.options).toEqual(["sidebar", "top_tabs", "three_columns"]);
  });
});
