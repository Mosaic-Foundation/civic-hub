import { describe, expect, it } from "vitest";

/**
 * Plugin switches, end to end (2026-10-07): the pure rules behind them.
 *
 * - search and link candidates take switched-off types out of the type
 *   filter (enabledProcessTypesAmong, src/services/pluginGate.ts);
 * - "needs setup" lives in one place (src/shared/pluginSetup.ts);
 * - the UI's decisions that take the config as arguments
 *   (ui/src/config/pluginRules.ts): where a new account lands, and which
 *   search chips are offered.
 *
 * tests/api/pluginToggles.test.ts proves the same against a server.
 */

import { ATHENS_HUB } from "../fixtures/hubs/index.js";
import { runWithHub } from "../../src/config/hubContext.js";
import { PLUGIN_SETUP, pluginSetupStatus, pluginShownGiven } from "../../src/shared/pluginSetup.js";
import { onboardingTarget, searchChipsShown } from "../../ui/src/config/pluginRules.js";

const { registeredProcessTypes } = await import("../../src/processes/registry.js");
const { enabledProcessTypesAmong } = await import("../../src/services/pluginGate.js");

const off = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [`plugin.${id}.enabled`, "false"]));

describe("enabledProcessTypesAmong (search, link candidates)", () => {
  it("leaves the filter alone while nothing is off", () => {
    runWithHub(ATHENS_HUB, {}, () => {
      expect(enabledProcessTypesAmong(null)).toBeNull();
      expect(enabledProcessTypesAmong(["civic.vote"])).toEqual(["civic.vote"]);
    });
  });

  it("'every type' becomes every registered type that is on", () => {
    runWithHub(ATHENS_HUB, off("meeting_summary", "vote"), () => {
      const types = enabledProcessTypesAmong(null)!;
      expect(types).not.toContain("civic.meeting_summary");
      expect(types).not.toContain("civic.vote");
      expect(types).not.toContain("civic.vote_results");
      expect(types.sort()).toEqual(
        registeredProcessTypes()
          .filter((t) => !["civic.meeting_summary", "civic.vote", "civic.vote_results"].includes(t))
          .sort(),
      );
    });
  });

  it("intersects a requested list, down to nothing", () => {
    runWithHub(ATHENS_HUB, off("vote"), () => {
      expect(enabledProcessTypesAmong(["civic.vote", "civic.announcement"])).toEqual(["civic.announcement"]);
      expect(enabledProcessTypesAmong(["civic.vote_results"])).toEqual([]);
    });
  });
});

describe("needs setup (src/shared/pluginSetup.ts)", () => {
  const settings = (values: Record<string, string>) => (k: string) => values[k];
  const noContent = () => false;

  it("covers Meeting summaries and News sync, and every rule names the keys it reads", () => {
    expect(Object.keys(PLUGIN_SETUP).sort()).toEqual(["meeting_summary", "news_sync"]);
    for (const [id, rule] of Object.entries(PLUGIN_SETUP)) {
      for (const k of rule.keys) expect(k.startsWith(`plugin.${id}.`), k).toBe(true);
      // Configured once every key it lists is set.
      const all = Object.fromEntries(rule.keys.map((k) => [k, "x"]));
      expect(pluginSetupStatus(id, settings(all), noContent)).toBeNull();
    }
  });

  it("Meeting summaries: a page or a channel is enough; until then hidden unless it has a summary", () => {
    const missing = pluginSetupStatus("meeting_summary", settings({}), noContent);
    expect(missing).toEqual({ missing: expect.stringMatching(/meeting source/), shown: false });
    expect(pluginSetupStatus("meeting_summary", settings({}), () => true)?.shown).toBe(true);
    expect(pluginSetupStatus("meeting_summary", settings({ "plugin.meeting_summary.source_url": "https://x.test" }), noContent)).toBeNull();
    expect(pluginSetupStatus("meeting_summary", settings({ "plugin.meeting_summary.youtube_channel_id": "UCx" }), noContent)).toBeNull();
    expect(pluginSetupStatus("meeting_summary", settings({ "plugin.meeting_summary.source_url": "  " }), noContent)).not.toBeNull();
  });

  it("News sync: needs both a connector and an address; content does not count", () => {
    expect(pluginSetupStatus("news_sync", settings({ "plugin.news_sync.connector": "wix-cms" }), () => true)).toEqual({
      missing: expect.any(String),
      shown: false,
    });
    expect(
      pluginSetupStatus("news_sync", settings({ "plugin.news_sync.connector": "wix-cms", "plugin.news_sync.source_url": "https://x.test" }), noContent),
    ).toBeNull();
  });

  it("a plugin with no rule never needs setup", () => {
    expect(pluginSetupStatus("vote", settings({}), noContent)).toBeNull();
  });

  it("shown on the public site: on, and set up or with something to show", () => {
    const setup = { meeting_summary: { missing: "m", shown: false }, news_sync: { missing: "n", shown: true } };
    expect(pluginShownGiven("meeting_summary", true, setup)).toBe(false);
    expect(pluginShownGiven("news_sync", true, setup)).toBe(true);
    expect(pluginShownGiven("vote", true, setup)).toBe(true);
    expect(pluginShownGiven("vote", false, setup)).toBe(false);
    expect(pluginShownGiven("vote", true, undefined)).toBe(true);
  });
});

describe("UI gating (ui/src/config/pluginRules.ts)", () => {
  it("a new account goes to the word cloud only when there is one AND Word clouds is on", () => {
    expect(onboardingTarget("proc_abc", true)).toBe("/wordcloud/proc_abc?onboarding=1");
    expect(onboardingTarget("proc_abc", false)).toBeNull();
    expect(onboardingTarget(undefined, true)).toBeNull();
    expect(onboardingTarget("  ", true)).toBeNull();
  });

  it("search chips: only types the hub shows", () => {
    const chips = [{ key: "vote" }, { key: "announcement" }, { key: "vote_results" }, { key: "meeting_summary" }];
    const shown = searchChipsShown(chips, (t) => t !== "civic.vote" && t !== "civic.vote_results");
    expect(shown.map((c) => c.key)).toEqual(["announcement", "meeting_summary"]);
    expect(searchChipsShown(chips, () => true)).toHaveLength(4);
  });
});
