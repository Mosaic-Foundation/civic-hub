import { describe, expect, it } from "vitest";
import { HELP, anchorForKey } from "../../src/shared/helpRegistry.js";
import { SETTINGS_NAV } from "../../src/shared/adminAnchors.js";
import { EDITABLE_SETTING_KEYS, PLUGIN_SECTION_INFO } from "../../src/shared/hubSettingsSections.js";
import {
  NOT_IN_SEARCH,
  SEARCH_WORDS,
  SOMETIMES_SHOWN,
  buildSearchIndex,
  normalize,
  pathForKey,
  pluginPanelAnchors,
  prepareIndex,
  searchSettings,
} from "../../src/shared/settingsSearch.js";

// The settings search (2026-11-10) is built on the help registry, which every
// setting must join (helpRegistry.test.ts). These keep the two in step, so a
// new setting cannot ship without being findable.

const index = buildSearchIndex();
const prepared = prepareIndex(index);
const first = (q: string) => searchSettings(q, prepared, 3)[0]?.key;
const top = (q: string, n = 3) => searchSettings(q, prepared, n).map((e) => e.key);

describe("what the settings search covers", () => {
  it("has an entry for every help key, or says why not", () => {
    const covered = new Set(index.map((e) => e.key));
    const missing = Object.keys(HELP).filter((k) => !covered.has(k) && !(k in NOT_IN_SEARCH));
    expect(missing, "add each to SEARCH_WORDS in src/shared/settingsSearch.ts, with its label").toEqual([]);
  });

  it("finds every setting an admin can edit, but each plugin's switch, which is its panel", () => {
    const covered = new Set(index.map((e) => e.key));
    const missing = EDITABLE_SETTING_KEYS.filter(
      (k) => !covered.has(k) && !/^plugin\.[a-z_]+\.enabled$/.test(k) && k !== "identity.banner_alt",
    );
    expect(missing).toEqual([]);
    for (const p of PLUGIN_SECTION_INFO) expect(covered.has(`plugins.${p.id}`), p.id).toBe(true);
  });

  it("finds every section", () => {
    for (const s of SETTINGS_NAV) expect(index.some((e) => e.key === `settings.${s.id}`), s.id).toBe(true);
  });

  it("lists no words, exclusion or sometimes-shown part for a key the help registry doesn't have", () => {
    const stray = [...Object.keys(SEARCH_WORDS), ...Object.keys(NOT_IN_SEARCH), ...Object.keys(SOMETIMES_SHOWN)].filter(
      (k) => !(k in HELP),
    );
    expect(stray).toEqual([]);
    expect(Object.keys(NOT_IN_SEARCH).filter((k) => k in SEARCH_WORDS)).toEqual([]);
  });

  it("gives every entry a label, a place in Hub settings and its own anchor", () => {
    for (const e of index) {
      expect(e.label.trim(), e.key).not.toBe("");
      expect(e.path, e.key).toMatch(/^\/admin\/settings\/[a-z-]+(#[a-z0-9-]+)?$/);
      const section = e.path.split("/")[3]!.split("#")[0];
      expect(SETTINGS_NAV.some((s) => s.id === section), e.key).toBe(true);
      if (!e.key.startsWith("settings.")) expect(e.path.endsWith(`#${anchorForKey(e.key)}`), e.key).toBe(true);
    }
  });

  it("puts each setting on the section that saves it", () => {
    expect(pathForKey("identity.theme")?.path).toBe("/admin/settings/theme#identity-theme");
    expect(pathForKey("plugin.vote.min_duration_days")?.path).toBe("/admin/settings/plugins#plugin-vote-min-duration-days");
    expect(pathForKey("mode.waitlist")?.path).toBe("/admin/settings/mode#mode-waitlist");
    expect(pathForKey("plugins.install")?.path).toBe("/admin/settings/plugins#plugins-install");
    expect(pathForKey("settings.mode")?.path).toBe("/admin/settings/mode");
    expect(pathForKey("share.invites")).toBeNull();
  });

  it("opens a plugin's panel for each of its settings", () => {
    expect(pluginPanelAnchors("vote")).toEqual(
      expect.arrayContaining(["plugins-vote", "plugin-vote-min-duration-days", "plugin-vote-default-check-mode"]),
    );
    expect(pluginPanelAnchors("meeting_summary")).toContain("plugin-meeting-summary-auto-publish");
  });

  it("names a plugin's setting by its plugin", () => {
    const e = index.find((x) => x.key === "plugin.digest.send_hour")!;
    expect(e.where).toBe("Plugins › Email digest");
  });
});

describe("finding a setting", () => {
  it("finds the waitlist however it is written", () => {
    expect(first("wait list")).toBe("mode.waitlist");
    expect(first("waitlist")).toBe("mode.waitlist");
    expect(first("Wait-list")).toBe("mode.waitlist");
    expect(first("waiting list")).toBe("mode.waitlist");
    expect(top("wait list")).toContain("settings.mode");
  });

  it("finds a setting by its label, a synonym or a spelling", () => {
    expect(first("logo")).toBe("identity.logo_url");
    expect(first("favicon")).toBe("identity.logo_url");
    expect(first("colour")).toBe("identity.theme");
    expect(first("colors")).toBe("identity.theme");
    expect(first("timezone")).toBe("identity.timezone");
    expect(first("time zone")).toBe("identity.timezone");
    expect(first("whitelist")).toBe("mode.allowlist");
    expect(first("tagline")).toBe("identity.tagline");
    expect(first("privacy")).toBe("legal.privacy");
    expect(first("rss")).toBe("plugins.news_sync");
    expect(first("closing soon")).toBe("feed.closing_reminder_hours");
  });

  it("reads past the words that say nothing", () => {
    expect(first("how do I change the logo")).toBe("identity.logo_url");
    expect(first("turn off votes")).toBe("plugins.vote");
    expect(first("add an admin")).toMatch(/^(settings\.people|people\.admins)$/);
  });

  it("finds a plugin's own settings", () => {
    expect(top("how long votes run")).toEqual(
      expect.arrayContaining(["plugin.vote.min_duration_days", "plugin.vote.max_duration_days", "plugin.vote.default_duration_days"]),
    );
    expect(first("digest time")).toBe("plugin.digest.send_hour");
    expect(first("polis server")).toBe("plugin.conversation.polis_url");
  });

  it("forgives one wrong letter only when nothing is spelled as typed", () => {
    expect(first("wating list")).toBe("mode.waitlist");
    expect(first("tagilne")).toBe("identity.tagline");
  });

  it("finds nothing for nothing, and nothing for nonsense", () => {
    expect(searchSettings("", prepared)).toEqual([]);
    expect(searchSettings("   ", prepared)).toEqual([]);
    expect(searchSettings("zzqx", prepared)).toEqual([]);
  });

  it("normalizes case, accents and punctuation", () => {
    expect(normalize("  Café & Wait-List!  ")).toBe("cafe and wait list");
  });
});
