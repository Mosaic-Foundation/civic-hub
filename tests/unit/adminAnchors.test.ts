import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGES,
  ADMIN_TABS,
  PLUGIN_ANCHORS,
  SETTINGS_NAV,
  SETTINGS_SUBSECTIONS,
  adminAnchorPath,
  pluginAnchor,
} from "../../src/shared/adminAnchors.js";

describe("admin anchors", () => {
  it("on /admin, a tab wins: #feedback is the Feedback tab, #moderation the Moderation tab", () => {
    expect(adminAnchorPath("#feedback", "admin")).toBe("/admin/feedback");
    expect(adminAnchorPath("#moderation", "admin")).toBe("/admin/moderation");
    expect(adminAnchorPath("#processes", "admin")).toBe("/admin/reviews");
  });

  it("on /admin/settings, #feedback is the plugin's panel", () => {
    expect(adminAnchorPath("#feedback", "settings")).toBe("/admin/settings/plugins#feedback");
    expect(adminAnchorPath("meeting-summary", "settings")).toBe("/admin/settings/plugins#meeting-summary");
  });

  it("a section opens itself, and a part of a section opens the section scrolled to it", () => {
    expect(adminAnchorPath("#participation", "settings")).toBe("/admin/settings/participation");
    expect(adminAnchorPath("#Threshold", "admin")).toBe("/admin/settings/participation#threshold");
    expect(adminAnchorPath("#waitlist", "settings")).toBe("/admin/settings/mode#waitlist");
  });

  it("an anchor that names nothing leads nowhere", () => {
    expect(adminAnchorPath("#nothing-here", "admin")).toBeNull();
    expect(adminAnchorPath("", "settings")).toBeNull();
  });

  it("plugin anchors use hyphens", () => {
    expect(pluginAnchor("admin_digest")).toBe("admin-digest");
  });

  it("/admin#contact-civic-social is the Contact Civic.Social page", () => {
    expect(adminAnchorPath("#contact-civic-social", "admin")).toBe("/admin/contact-civic-social");
  });

  it("no two places share an anchor, apart from the Feedback tab and plugin (resolved by the page)", () => {
    const settings = [
      ...SETTINGS_NAV.map((s) => s.id),
      ...PLUGIN_ANCHORS,
      ...Object.values(SETTINGS_SUBSECTIONS).flat(),
    ];
    expect(new Set(settings).size).toBe(settings.length);
    const tabs = [...ADMIN_TABS, ...ADMIN_PAGES].map((t) => t.anchor);
    expect(new Set(tabs).size).toBe(tabs.length);
    const shared = tabs.filter((t) => settings.includes(t));
    expect(shared).toEqual(["feedback"]);
    for (const a of [...settings, ...tabs]) expect(a).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});
