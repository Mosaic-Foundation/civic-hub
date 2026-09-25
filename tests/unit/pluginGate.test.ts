import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase 2c: plugin.<id>.enabled takes effect at runtime, per hub.
 *
 * The rules that need no server: every process type belongs to a plugin and
 * the UI agrees which; a switched-off type cannot be created in scope while
 * another hub's scope can; the Plugins section covers every plugin id and its
 * choices are the connectors that exist; the vote duration range is read per
 * hub and can never be made unusable. tests/api/pluginToggles.test.ts proves
 * the same end to end.
 */

import { ATHENS_HUB, FLOYD_HUB } from "../fixtures/hubs/index.js";
import { runWithHub } from "../../src/config/hubContext.js";
import { PLUGIN_IDS } from "../../src/models/hubSettings.js";
import {
  MEETING_CONNECTOR_OPTIONS,
  NEWS_CONNECTOR_OPTIONS,
  PLUGIN_SECTION_ORDER,
  SETTINGS_SECTIONS,
  fieldSpec,
} from "../../src/shared/hubSettingsSections.js";
import { normalizeValue } from "../../src/models/hubSettingsWrite.js";

const { PROCESS_TYPE_PLUGINS, registeredProcessTypes } = await import("../../src/processes/registry.js");
const {
  PluginDisabledError,
  assertProcessTypeEnabled,
  disabledProcessTypes,
  isProcessTypeEnabled,
} = await import("../../src/services/pluginGate.js");
const { voteDurationLimitsSync } = await import("../../src/services/hubSettings.js");
const { CONNECTORS } = await import("../../src/modules/civic.meeting_summary/connectors/index.js");
const { NEWS_CONNECTORS } = await import("../../src/modules/civic.news_sync/connectors/index.js");

const off = (id: string) => ({ [`plugin.${id}.enabled`]: "false" });

describe("process types and plugins", () => {
  it("every registered type names a plugin, and only registered types do", () => {
    expect(Object.keys(PROCESS_TYPE_PLUGINS).sort()).toEqual(registeredProcessTypes().sort());
    for (const plugin of Object.values(PROCESS_TYPE_PLUGINS)) expect(PLUGIN_IDS).toContain(plugin);
  });

  it("the UI's copy of the map is the server's", () => {
    const ui = readFileSync(new URL("../../ui/src/config/plugins.tsx", import.meta.url), "utf8");
    const block = ui.slice(ui.indexOf("PROCESS_TYPE_PLUGINS"), ui.indexOf("};", ui.indexOf("PROCESS_TYPE_PLUGINS")));
    const pairs = Object.fromEntries([...block.matchAll(/"([a-z._]+)":\s*"([a-z_]+)"/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(PROCESS_TYPE_PLUGINS);
  });

  it("a type switched off on Athens cannot be created there, and can on Floyd", () => {
    runWithHub(ATHENS_HUB, off("wordcloud"), () => {
      expect(isProcessTypeEnabled("civic.wordcloud")).toBe(false);
      expect(disabledProcessTypes()).toEqual(["civic.wordcloud"]);
      expect(() => assertProcessTypeEnabled("civic.wordcloud")).toThrow(PluginDisabledError);
      expect(() => assertProcessTypeEnabled("civic.vote")).not.toThrow();
    });
    runWithHub(FLOYD_HUB, {}, () => {
      expect(() => assertProcessTypeEnabled("civic.wordcloud")).not.toThrow();
      expect(disabledProcessTypes()).toEqual([]);
    });
  });

  it("votes off takes their legacy results record with them", () => {
    runWithHub(ATHENS_HUB, off("vote"), () => {
      expect(disabledProcessTypes().sort()).toEqual(["civic.vote", "civic.vote_results"]);
    });
  });
});

describe("the Plugins section", () => {
  it("has an on/off for every plugin id in the build plan", () => {
    expect([...PLUGIN_SECTION_ORDER].sort()).toEqual([...PLUGIN_IDS].sort());
    const keys = SETTINGS_SECTIONS.plugins.map((f) => f.key);
    for (const id of PLUGIN_IDS) expect(keys).toContain(`plugin.${id}.enabled`);
  });

  it("owns the digest keys now; Email no longer does", () => {
    const email = SETTINGS_SECTIONS.email.map((f) => f.key);
    expect(email).not.toContain("plugin.digest.enabled");
    expect(email).not.toContain("plugin.digest.send_hour");
    expect(fieldSpec("plugin.digest.send_hour")?.kind).toBe("hour");
  });

  it("repeats no key another section owns (one writer per key)", () => {
    const all = Object.values(SETTINGS_SECTIONS).flatMap((s) => s.map((f) => f.key));
    expect(new Set(all).size).toBe(all.length);
    for (const k of ["plugin.vote.support_threshold", "moderation.comment_identity_mode", "people.brief_recipients", "people.announcement_authors"]) {
      expect(all).not.toContain(k);
    }
  });

  it("offers exactly the connectors that exist", () => {
    expect([...MEETING_CONNECTOR_OPTIONS].sort()).toEqual(["auto", ...Object.keys(CONNECTORS)].sort());
    expect([...NEWS_CONNECTOR_OPTIONS].sort()).toEqual(Object.keys(NEWS_CONNECTORS).sort());
  });

  it("validates the new kinds", () => {
    const spec = (k: string) => fieldSpec(k)!;
    expect(normalizeValue(spec("plugin.conversation.polis_url"), " https://polis.example ")).toBe("https://polis.example");
    expect(normalizeValue(spec("plugin.conversation.polis_url"), "javascript:alert(1)")).toHaveProperty("error");
    expect(normalizeValue(spec("plugin.meeting_summary.connector_id"), "youtube-channel")).toBe("youtube-channel");
    expect(normalizeValue(spec("plugin.meeting_summary.connector_id"), "made-up")).toHaveProperty("error");
    expect(normalizeValue(spec("plugin.meeting_summary.cutoff_date"), "2026-01-31")).toBe("2026-01-31");
    expect(normalizeValue(spec("plugin.meeting_summary.cutoff_date"), "31/01/2026")).toHaveProperty("error");
    expect(normalizeValue(spec("plugin.vote.min_duration_days"), "7")).toBe("7");
    expect(normalizeValue(spec("plugin.vote.min_duration_days"), "0")).toHaveProperty("error");
    expect(normalizeValue(spec("plugin.vote.min_duration_days"), "2.5")).toHaveProperty("error");
    expect(normalizeValue(spec("plugin.vote.min_duration_days"), "")).toBe("");
    expect(normalizeValue(spec("identity.timezone"), "America/New_York")).toBe("America/New_York");
    expect(normalizeValue(spec("identity.timezone"), "Nowhere/Special")).toHaveProperty("error");
  });
});

describe("vote duration range, per hub", () => {
  it("unset keeps the numbers that were in code: 14, 90, default 42", () => {
    runWithHub(FLOYD_HUB, {}, () => {
      expect(voteDurationLimitsSync()).toEqual({ minDays: 14, maxDays: 90, defaultDays: 42 });
    });
  });

  it("reads the hub's own range", () => {
    runWithHub(ATHENS_HUB, {
      "plugin.vote.min_duration_days": "7",
      "plugin.vote.max_duration_days": "30",
      "plugin.vote.default_duration_days": "10",
    }, () => {
      expect(voteDurationLimitsSync()).toEqual({ minDays: 7, maxDays: 30, defaultDays: 10 });
    });
  });

  it("a backwards range is turned round and the default kept inside it", () => {
    runWithHub(ATHENS_HUB, {
      "plugin.vote.min_duration_days": "60",
      "plugin.vote.max_duration_days": "20",
      "plugin.vote.default_duration_days": "90",
    }, () => {
      expect(voteDurationLimitsSync()).toEqual({ minDays: 20, maxDays: 60, defaultDays: 60 });
    });
  });
});
