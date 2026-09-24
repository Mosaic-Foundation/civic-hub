import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithHub, withHubScope } from "../../src/config/hubContext.js";
import {
  buildParaphrasePrompt,
  discoverNewsEntries,
  parseRssFeed,
  resolveNewsSyncConfig,
  wixPostUrlPattern,
} from "../../src/modules/civic.news_sync/index.js";
import { civicPlaceShortName } from "../../src/config/hub.js";
import {
  ATHENS_HUB,
  ATHENS_NEWS_FEED_URL,
  ATHENS_SETTINGS,
  BARE_HUB,
  FLOYD_HUB,
  FLOYD_NEWS_FEED_URL,
  FLOYD_SETTINGS,
  PLUGIN_ENV_FALLBACKS,
} from "../fixtures/hubs/index.js";
import { wixBlogFeed } from "../fixtures/hubs/wix-blog-feed.js";

/**
 * News sync reads the hub's feed, through the hub's connector, and nothing
 * else.
 *
 * Until 2026-09-24 the module was Floyd's: its feed URL was the code default,
 * the permalink check accepted only Floyd's domain, and every synced post was
 * filed under Floyd's jurisdiction and signed "Floyd County Government" — on
 * whichever hub ran it. These tests hold the two hubs side by side and check
 * that each gets its own configuration and never the other's.
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

const TODAY = "2026-09-24";

describe("resolveNewsSyncConfig — per hub, no defaults", () => {
  it("gives Athens Athens's connector and feed", () => {
    const r = runWithHub(ATHENS_HUB, ATHENS_SETTINGS, resolveNewsSyncConfig);
    expect(r).toEqual({
      status: "ready",
      cfg: { connector: "wix-cms", source_url: ATHENS_NEWS_FEED_URL },
      maxPerRun: 5,
    });
  });

  it("gives Floyd Floyd's, as seeded", () => {
    const r = runWithHub(FLOYD_HUB, FLOYD_SETTINGS, resolveNewsSyncConfig);
    expect(r.status === "ready" && r.cfg.source_url).toBe(FLOYD_NEWS_FEED_URL);
  });

  it("skips a hub that configured nothing — there is no default feed", () => {
    const r = runWithHub(BARE_HUB, {}, resolveNewsSyncConfig);
    expect(r).toEqual({ status: "skipped", reason: "news sync not configured" });
  });

  it("skips a hub that switched it off, even with a feed configured", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { ...ATHENS_SETTINGS, "plugin.news_sync.enabled": "false" },
      resolveNewsSyncConfig,
    );
    expect(r.status).toBe("skipped");
  });

  it("refuses a feed with no connector, rather than guessing one", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { "plugin.news_sync.source_url": ATHENS_NEWS_FEED_URL },
      resolveNewsSyncConfig,
    );
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.reason).toContain("plugin.news_sync.connector");
  });

  it("refuses an unknown connector, naming the known ones", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { ...ATHENS_SETTINGS, "plugin.news_sync.connector": "granicus" },
      resolveNewsSyncConfig,
    );
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.reason).toContain("wix-cms");
  });

  it("refuses a connector with no feed", () => {
    const r = runWithHub(
      ATHENS_HUB,
      { "plugin.news_sync.connector": "wix-cms" },
      resolveNewsSyncConfig,
    );
    expect(r.status).toBe("invalid");
  });
});

describe("discovery — Athens reads Athens's feed and accepts only Athens's posts", () => {
  it("fetches Athens's URL and never Floyd's", async () => {
    const fetched: string[] = [];
    const fetchText = async (url: string) => {
      fetched.push(url);
      return wixBlogFeed("https://www.athens.example");
    };

    const entries = await withHubScope(ATHENS_HUB, ATHENS_SETTINGS, async () => {
      const r = resolveNewsSyncConfig();
      if (r.status !== "ready") throw new Error(`not ready: ${JSON.stringify(r)}`);
      return discoverNewsEntries(r.cfg, { fetchText }, TODAY);
    });

    expect(fetched).toEqual([ATHENS_NEWS_FEED_URL]);
    expect(fetched.join()).not.toMatch(/floyd/i);
    // The 2020 workshop is past-dated and filtered; the other two remain.
    expect(entries.map((e) => e.share_url)).toEqual([
      "https://www.athens.example/post/lawn-care-bid",
      "https://www.athens.example/post/board-of-supervisors-meeting-04-28-2099",
    ]);
  });

  it("drops a post on another site's domain, even when the feed carries one", () => {
    const foreign = `<item><title>Not ours</title><link>https://www.floydcova.gov/post/not-ours</link></item>`;
    const entries = parseRssFeed(
      wixBlogFeed("https://www.athens.example", foreign),
      "https://www.athens.example",
    );
    expect(entries.map((e) => e.share_url)).not.toContain(
      "https://www.floydcova.gov/post/not-ours",
    );
    expect(entries).toHaveLength(3);
  });

  it("accepts exactly the permalinks Floyd's hardcoded pattern accepted, on Floyd's origin", () => {
    // The pattern that shipped until 2026-09-24, kept here as the reference.
    const legacy = /^https:\/\/www\.floydcova\.gov\/post\/[A-Za-z0-9_-]+$/;
    const derived = wixPostUrlPattern(new URL(FLOYD_NEWS_FEED_URL).origin);
    for (const url of [
      "https://www.floydcova.gov/post/lawn-care-bid",
      "https://www.floydcova.gov/post/burn_ban-2026",
      "https://www.floydcova.gov/post/",
      "https://www.floydcova.gov/post/a/b",
      "https://floydcova.gov/post/lawn-care-bid",
      "http://www.floydcova.gov/post/lawn-care-bid",
      "https://www.floydcovaxgov/post/lawn-care-bid",
      "https://www.floydcova.gov/news/lawn-care-bid",
    ]) {
      expect(derived.test(url), url).toBe(legacy.test(url));
    }
  });
});

describe("paraphrase prompt — the hub's own names", () => {
  const input = { title: "Lawn Care Bid", event_date: null };

  it("reads for Floyd exactly as the examples always did", () => {
    const prompt = runWithHub(FLOYD_HUB, FLOYD_SETTINGS, () =>
      buildParaphrasePrompt(input, {
        place: civicPlaceShortName(),
        governing_body: FLOYD_SETTINGS["copy.governing_body_name"],
      }),
    );
    expect(prompt).toContain("Output: Floyd County is accepting bids for lawn care services.");
    expect(prompt).toContain('Title: "Board of Supervisors Meeting 04/28/2026"');
    expect(prompt).toContain("Door 2 of the Floyd County Government Building is closed");
    expect(prompt).toContain(
      'If the title says "Floyd County", do not say "Floyd County DPW" or "Floyd County Sheriff"',
    );
  });

  it("names Athens for Athens, and Floyd nowhere", () => {
    const prompt = runWithHub(ATHENS_HUB, ATHENS_SETTINGS, () =>
      buildParaphrasePrompt(input, {
        place: civicPlaceShortName(),
        governing_body: ATHENS_SETTINGS["copy.governing_body_name"],
      }),
    );
    expect(prompt).toContain("Town of Athens is accepting bids");
    expect(prompt).toContain("The Town Council will meet on April 28, 2026.");
    expect(prompt).not.toMatch(/floyd|supervisors/i);
  });

  it("has neutral examples for a hub with no place and no governing body", () => {
    const prompt = buildParaphrasePrompt(input);
    expect(prompt).toContain("The local government is accepting bids");
    expect(prompt).not.toMatch(/floyd|supervisors|athens/i);
  });
});
