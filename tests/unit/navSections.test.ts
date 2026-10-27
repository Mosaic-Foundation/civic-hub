// The hub's sections and their one order (src/shared/navSections.ts): Feed
// first, the enabled types' sections and Members in the hub's order, a newly
// enabled section at the end, and the first four on the phone's bar.

import { describe, expect, it } from "vitest";
import { processTypeDisplays } from "../../src/processes/registry.js";
import {
  barSections,
  orderAfterSwitchingOff,
  orderedSections,
  parseSectionOrder,
  sectionForPath,
} from "../../src/shared/navSections.js";

const types = processTypeDisplays();
const all = () => true;
const ids = (order: string[], enabled: (p: string) => boolean = all) =>
  orderedSections({ types, enabled, order }).map((s) => s.id);

describe("the hub's sections", () => {
  it("default to today's strip, Feed first, then Members", () => {
    expect(ids([])).toEqual(["feed", "conversations", "proposals", "votes", "events", "projects", "outcomes", "members"]);
  });

  it("put Feed, Discuss, Proposals and Votes on the phone's bar by default", () => {
    const bar = barSections(orderedSections({ types, enabled: all, order: [] }));
    expect(bar.map((s) => s.short)).toEqual(["Feed", "Discuss", "Proposals", "Votes"]);
  });

  it("follow the hub's order, and the bar follows it too", () => {
    const order = ["votes", "members", "proposals"];
    expect(ids(order)).toEqual(["feed", "votes", "members", "proposals", "conversations", "events", "projects", "outcomes"]);
    expect(barSections(orderedSections({ types, enabled: all, order })).map((s) => s.id)).toEqual([
      "feed",
      "votes",
      "members",
      "proposals",
    ]);
  });

  it("drop a switched-off plugin's section everywhere, and keep its place for when it returns", () => {
    const order = ["votes", "conversations", "proposals"];
    const noConversations = (p: string) => p !== "conversation";
    expect(ids(order, noConversations)).toEqual(["feed", "votes", "proposals", "events", "projects", "outcomes", "members"]);
    expect(ids(order)).toEqual(["feed", "votes", "conversations", "proposals", "events", "projects", "outcomes", "members"]);
  });

  it("append a section the order does not name (a plugin newly switched on) after the named ones", () => {
    expect(ids(["members", "votes"], (p) => p !== "project")).toEqual([
      "feed",
      "members",
      "votes",
      "conversations",
      "proposals",
      "events",
      "outcomes",
    ]);
  });

  it("give a plugin's type its section from the registry, with no list to edit", () => {
    const plugin = {
      type: "example.petition",
      plugin: "petition",
      label: "Petition",
      plural: "Petitions",
      icon: "petition",
      section: { id: "petitions", label: "Petitions", path: "/petitions", detail_paths: ["/petition/"], order: 35 },
    };
    const withPlugin = orderedSections({ types: [...types, plugin], enabled: all, order: [] });
    expect(withPlugin.map((s) => s.id)).toEqual([
      "feed",
      "conversations",
      "proposals",
      "votes",
      "events",
      "petitions",
      "projects",
      "outcomes",
      "members",
    ]);
    const off = orderedSections({ types: [...types, plugin], enabled: (p) => p !== "petition", order: [] });
    expect(off.map((s) => s.id)).not.toContain("petitions");
  });

  it("ignore an unreadable stored order", () => {
    expect(parseSectionOrder("not json")).toEqual([]);
    expect(parseSectionOrder('{"a":1}')).toEqual([]);
    expect(parseSectionOrder('["votes",3]')).toEqual(["votes"]);
    expect(parseSectionOrder(undefined)).toEqual([]);
  });

  it("know which section a page belongs to, detail pages included", () => {
    const sections = orderedSections({ types, enabled: all, order: [] });
    expect(sectionForPath("/", sections)).toBe("feed");
    expect(sectionForPath("/deliberations", sections)).toBe("conversations");
    expect(sectionForPath("/deliberation/abc", sections)).toBe("conversations");
    expect(sectionForPath("/proposal/abc", sections)).toBe("proposals");
    expect(sectionForPath("/process/abc", sections)).toBe("votes");
    expect(sectionForPath("/votes/abc/log", sections)).toBe("votes");
    expect(sectionForPath("/brief/abc", sections)).toBe("outcomes");
    expect(sectionForPath("/vote-results/abc", sections)).toBe("outcomes");
    expect(sectionForPath("/members", sections)).toBe("members");
    expect(sectionForPath("/admin/settings", sections)).toBeNull();
  });
});

describe("switching a plugin off (Adam, 2026-10-14: a newly enabled section goes to the end)", () => {
  it("takes its section out of the stored order", () => {
    expect(
      orderAfterSwitchingOff({ stored: '["votes","conversations","proposals"]', switchedOff: ["conversation"], types }),
    ).toBe('["votes","proposals"]');
  });

  it("so switching it on again puts it at the end", () => {
    const order = parseSectionOrder('["votes","proposals"]');
    expect(ids(order)).toEqual(["feed", "votes", "proposals", "conversations", "events", "projects", "outcomes", "members"]);
  });

  it("changes nothing with no order stored, or no listed section off", () => {
    expect(orderAfterSwitchingOff({ stored: undefined, switchedOff: ["conversation"], types })).toBeNull();
    expect(orderAfterSwitchingOff({ stored: '["votes"]', switchedOff: ["wordcloud"], types })).toBeNull();
    expect(orderAfterSwitchingOff({ stored: '["votes"]', switchedOff: [], types })).toBeNull();
  });

  it("clears an order that held only switched-off sections", () => {
    expect(orderAfterSwitchingOff({ stored: '["votes"]', switchedOff: ["vote"], types })).toBe("");
  });
});

describe("the Members plugin's section (2026-10-14)", () => {
  it("is drawn only while its plugin says so (switched on, past its threshold or shown anyway, or an admin)", () => {
    expect(ids([], (p) => p !== "members")).toEqual(["feed", "conversations", "proposals", "votes", "events", "projects", "outcomes"]);
    expect(ids([])).toContain("members");
  });

  it("leaves the stored order when the plugin is switched off, so it comes back at the end", () => {
    expect(
      orderAfterSwitchingOff({ stored: '["members","votes","proposals"]', switchedOff: ["members"], types }),
    ).toBe('["votes","proposals"]');
  });
});
