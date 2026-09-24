import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import {
  AUTO_ORDER,
  CONNECTORS,
  buildDiscoveryPrompt,
  canonicalConnectorId,
  resolveMeetingSummaryConfig,
  sitePdfPattern,
} from "../../src/modules/civic.meeting_summary/index.js";
import {
  ATHENS_HUB,
  ATHENS_MEETINGS_URL,
  ATHENS_SETTINGS,
  BARE_HUB,
  FLOYD_HUB,
  FLOYD_MEETINGS_URL,
  FLOYD_SETTINGS,
  FLOYD_YOUTUBE_CHANNEL_ID,
  PLUGIN_ENV_FALLBACKS,
} from "../fixtures/hubs/index.js";

/**
 * Meeting summaries read the hub's `plugin.meeting_summary.*` and nothing else.
 *
 * The connector ladder already existed; what these check is that nothing on
 * it defaults to one hub's source. Until 2026-09-24 the HTML connector was
 * registered as Floyd's, accepted only PDFs on Floyd's domain, and the cron
 * filed every summary under Floyd's jurisdiction.
 */

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of PLUGIN_ENV_FALLBACKS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of PLUGIN_ENV_FALLBACKS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const MODEL = "test-model";

describe("resolveMeetingSummaryConfig — per hub, no defaults", () => {
  it("gives Athens Athens's connector, page and filter, and none of Floyd's", () => {
    const r = runWithHub(ATHENS_HUB, ATHENS_SETTINGS, () => resolveMeetingSummaryConfig(MODEL));
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.connectorId).toBe("wix-cms");
    expect(r.cfg.source_url).toBe(ATHENS_MEETINGS_URL);
    expect(r.cfg.title_filter).toBe("Town Council");
    expect(r.cfg.type_exclude).toBe("");
    expect(r.cfg.channel_id).toBe("");
    expect(r.cfg.governing_body_name).toBe("Town Council");
    expect(JSON.stringify(r)).not.toMatch(/floyd|supervisors|EMS/i);
  });

  it("gives Floyd Floyd's, as seeded", () => {
    const r = runWithHub(FLOYD_HUB, FLOYD_SETTINGS, () => resolveMeetingSummaryConfig(MODEL));
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.connectorId).toBe("auto");
    expect(r.cfg.source_url).toBe(FLOYD_MEETINGS_URL);
    expect(r.cfg.channel_id).toBe(FLOYD_YOUTUBE_CHANNEL_ID);
    expect(r.cfg.type_exclude).toBe("EMS Board,EMS Meeting");
  });

  it("skips a hub with no source — every value is empty, not Floyd's", () => {
    const r = runWithHub(BARE_HUB, {}, () => resolveMeetingSummaryConfig(MODEL));
    expect(r).toEqual({ status: "skipped", reason: "meeting summary not configured" });
  });

  it("skips a hub that switched it off", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { ...ATHENS_SETTINGS, "plugin.meeting_summary.enabled": "false" },
      () => resolveMeetingSummaryConfig(MODEL),
    );
    expect(r.status).toBe("skipped");
  });

  it("refuses an explicit connector missing the source it needs", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { "plugin.meeting_summary.connector_id": "youtube-channel" },
      () => resolveMeetingSummaryConfig(MODEL),
    );
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.reason).toContain("youtube_channel_id");
  });

  it("refuses an unknown connector", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { ...ATHENS_SETTINGS, "plugin.meeting_summary.connector_id": "granicus" },
      () => resolveMeetingSummaryConfig(MODEL),
    );
    expect(r.status).toBe("invalid");
  });

  it("still honours the connector's pre-rename id, which a stored row may hold", () => {
    const legacy = ["floyd", "minutes", "page"].join("-");
    expect(canonicalConnectorId(legacy)).toBe("minutes-page");
    const r = runWithHub(
      ATHENS_HUB,
      { ...ATHENS_SETTINGS, "plugin.meeting_summary.connector_id": legacy },
      () => resolveMeetingSummaryConfig(MODEL),
    );
    expect(r.status === "ready" && r.connectorId).toBe("minutes-page");
  });
});

describe("the connector ladder names no hub", () => {
  it("registers only placeless ids", () => {
    expect(Object.keys(CONNECTORS).sort()).toEqual(["minutes-page", "wix-cms", "youtube-channel"]);
    expect(AUTO_ORDER).toEqual(["wix-cms", "minutes-page", "youtube-channel"]);
    for (const c of Object.values(CONNECTORS)) {
      expect(`${c.id} ${c.description}`).not.toMatch(/floyd|supervisors/i);
    }
  });

  it("accepts minutes PDFs only on the configured site", () => {
    const athens = sitePdfPattern(new URL(ATHENS_MEETINGS_URL).origin);
    expect(athens.test("https://www.athens.example/_files/ugd/ab12_cd34.pdf")).toBe(true);
    expect(athens.test("https://www.floydcova.gov/_files/ugd/ab12_cd34.pdf")).toBe(false);
  });

  it("accepts exactly the PDFs Floyd's hardcoded pattern accepted, on Floyd's origin", () => {
    // The pattern that shipped until 2026-09-24, kept here as the reference.
    const legacy = /^https:\/\/www\.floydcova\.gov\/_files\/ugd\/.+\.pdf$/i;
    const derived = sitePdfPattern(new URL(FLOYD_MEETINGS_URL).origin);
    for (const url of [
      "https://www.floydcova.gov/_files/ugd/db2c48_1e9a.pdf",
      "https://www.floydcova.gov/_files/ugd/49fff5_X.PDF",
      "https://www.floydcova.gov/_files/ugd/.pdf",
      "https://www.floydcova.gov/_files/other/db2c48.pdf",
      "http://www.floydcova.gov/_files/ugd/db2c48.pdf",
      "https://floydcova.gov/_files/ugd/db2c48.pdf",
      "https://www.floydcovaXgov/_files/ugd/db2c48.pdf",
    ]) {
      expect(derived.test(url), url).toBe(legacy.test(url));
    }
  });

  it("writes the discovery example with the hub's governing body", () => {
    const base = { extraction_instructions: "", trimmed_html: "<main></main>", source_url: ATHENS_MEETINGS_URL };
    const floyd = buildDiscoveryPrompt({ ...base, governing_body: "Board of Supervisors" });
    expect(floyd).toContain('(e.g. "Board of Supervisors Regular Meeting", "Budget Workshop")');
    expect(floyd).toContain('(e.g. "2026-06-09:Board of Supervisors Regular Meeting")');

    const athens = buildDiscoveryPrompt({ ...base, governing_body: "Town Council" });
    expect(athens).toContain('"Town Council Regular Meeting"');
    expect(athens).not.toMatch(/supervisors|floyd/i);

    expect(buildDiscoveryPrompt(base)).toContain('(e.g. "Regular Meeting", "Budget Workshop")');
  });
});
