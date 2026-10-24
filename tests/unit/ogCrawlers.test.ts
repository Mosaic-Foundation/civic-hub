// vercel.json sends only crawlers to the share-card function (api/og.ts);
// browsers get index.html from the CDN (audit F6, ADR-012). Pinned here:
// every /api/og rewrite carries the one user-agent match, it is a superset of
// the agents og.ts answers with a card (so no crawler loses its card), it
// ignores case, and it lets the common browsers through to the CDN.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OG_ROUTE_AGENTS, ogRoutePattern } from "../../src/hosting/ogCrawlers.js";
import { isSocialCrawler } from "../../api/og.js";

const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  rewrites: Array<{ source: string; destination: string; has?: Array<{ type: string; key: string; value: string }> }>;
};
// Vercel matches a `has` value against the whole header.
const routed = (ua: string) => new RegExp(`^${ogRoutePattern()}$`).test(ua);

const CRAWLERS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  "Facebot",
  "Twitterbot/1.0",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "WhatsApp/2.23.20.0",
  "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  "TelegramBot (like TwitterBot)",
  "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)",
  "Pinterest/0.2 (+https://www.pinterest.com/bot.html)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)",
  "Iframely/1.3.1 (+https://iframely.com/docs/about)",
  "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
  "http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)",
  "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)",
];

const BROWSERS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
];

describe("the /api/og rewrites", () => {
  const og = vercel.rewrites.filter((r) => r.destination === "/api/og");

  it("every one carries the crawler match, and nothing else does", () => {
    expect(og.length).toBeGreaterThanOrEqual(9);
    for (const r of og) {
      expect(r.has, r.source).toEqual([{ type: "header", key: "user-agent", value: ogRoutePattern() }]);
    }
    expect(vercel.rewrites.at(-1)).toEqual({ source: "/(.*)", destination: "/index.html" });
  });

  it.each(CRAWLERS)("routes %s to the share card", (ua) => {
    expect(routed(ua)).toBe(true);
  });

  it("ignores case", () => {
    for (const agent of OG_ROUTE_AGENTS) {
      expect(routed(agent.toUpperCase()), agent).toBe(true);
      expect(routed(agent[0].toUpperCase() + agent.slice(1)), agent).toBe(true);
    }
  });

  it("routes every agent og.ts answers with a card", () => {
    for (const ua of CRAWLERS.filter(isSocialCrawler)) expect(routed(ua), ua).toBe(true);
  });

  it.each(BROWSERS)("lets a browser through to the CDN: %s", (ua) => {
    expect(routed(ua)).toBe(false);
    expect(isSocialCrawler(ua)).toBe(false);
  });
});
