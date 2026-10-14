import { describe, expect, it } from "vitest";
import { HELP, anchorForKey, helpUrl } from "../../src/shared/helpRegistry.js";
import { SETTINGS_NAV } from "../../src/shared/adminAnchors.js";
import { EDITABLE_SETTING_KEYS, PLUGIN_SECTION_ORDER } from "../../src/shared/hubSettingsSections.js";
import { checkHelpAnchors } from "../../scripts/check-help-anchors.js";

// Parts of a section with their own "?" in the UI (ui/src/pages/settings/).
const PARTS = [
  "participation.threshold",
  "participation.anonymity",
  "mode.allowlist",
  "mode.waitlist",
  "people.admins",
  "people.board",
  "officials.extra_recipients",
  // Admin → Feedback's Send to Civic.Social, and the Contact Civic.Social
  // page (feedback routing, 2026-10-13).
  "admin.feedback_forward",
  "admin.contact_civic_social",
];

// Settings with no field of their own: each plugin's switch sits under its
// panel's "?" (plugins.<id>), and the banner's alt text is part of the
// banner's field.
const NO_FIELD = (k: string) => /^plugin\.[a-z_]+\.enabled$/.test(k) || k === "identity.banner_alt";

const REQUIRED = [
  ...SETTINGS_NAV.map((s) => `settings.${s.id}`),
  ...PLUGIN_SECTION_ORDER.map((id) => `plugins.${id}`),
  ...PARTS,
  ...EDITABLE_SETTING_KEYS.filter((k) => !NO_FIELD(k)),
];

describe("help registry", () => {
  it("has a note for every section, plugin panel, part and setting", () => {
    expect(REQUIRED.filter((k) => !HELP[k])).toEqual([]);
  });

  it("has no note nothing shows", () => {
    expect(Object.keys(HELP).filter((k) => !REQUIRED.includes(k))).toEqual([]);
  });

  it("keeps each note short, and each link to a docs page and its key's own anchor", () => {
    for (const [key, e] of Object.entries(HELP)) {
      expect(e.text.length, key).toBeGreaterThan(20);
      expect(e.text.length, key).toBeLessThanOrEqual(240);
      expect(e.text, key).not.toMatch(/—/);
      expect(e.page, key).toMatch(/^\/[a-z0-9/-]*$/);
      expect(e.anchor, key).toBe(anchorForKey(key));
    }
  });

  it("links a pending key to its page's top, and any other to its anchor", () => {
    expect(helpUrl({ text: "x", page: "/reference/plugins", anchor: "plugins-search", pending: true })).toBe(
      "https://docs.civic.social/reference/plugins",
    );
    expect(helpUrl({ text: "x", page: "/reference/plugins", anchor: "plugins-search" })).toBe(
      "https://docs.civic.social/reference/plugins#plugins-search",
    );
  });
});

describe("the help anchor check", () => {
  const key = "settings.participation";
  const page = HELP[key].page;
  const others = Object.fromEntries(
    Object.entries(HELP)
      .filter(([k]) => k !== key)
      .map(([, e]) => [e.page, [] as string[]]),
  );
  const all = (ids: string[]) => {
    const pages: Record<string, string[]> = {};
    for (const e of Object.values(HELP)) (pages[e.page] ??= []).push(e.anchor);
    pages[page] = ids;
    return { ...others, ...pages };
  };

  it("passes when every anchor is published", () => {
    const pages: Record<string, string[]> = {};
    for (const e of Object.values(HELP)) (pages[e.page] ??= []).push(e.anchor);
    expect(checkHelpAnchors({ pages }).errors).toEqual([]);
  });

  it("fails when a page drops a key's anchor, and says which", () => {
    const { errors } = checkHelpAnchors({ pages: all(["something-else"]) });
    expect(errors.some((e) => e.startsWith(`${key}:`) && e.includes(`#${HELP[key].anchor}`))).toBe(true);
  });

  it("treats a page with or without its trailing slash as one page", () => {
    const pages: Record<string, string[]> = {};
    for (const e of Object.values(HELP)) (pages[e.page.endsWith("/") ? e.page.slice(0, -1) : `${e.page}/`] ??= []).push(e.anchor);
    expect(checkHelpAnchors({ pages }).errors).toEqual([]);
  });
});
