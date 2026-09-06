// api/og.ts serves a page's Open Graph tags only to user-agents it recognises
// as social crawlers; everyone else gets the SPA. Meta uses several agents,
// and missing one is invisible in normal use: the published post still
// previews (facebookexternalhit is listed) while the share composer — which
// fetches with meta-externalfetcher — shows a bare domain chip. This pins
// the agents so the list can't quietly regress.

import { describe, it, expect } from "vitest";
import { isSocialCrawler } from "../../api/og.js";

describe("isSocialCrawler", () => {
  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Facebot",
    "Twitterbot/1.0",
    "LinkedInBot/1.0",
    "WhatsApp/2.23.20.0",
  ])("recognises %s", (ua) => {
    expect(isSocialCrawler(ua)).toBe(true);
  });

  it("serves the SPA to a browser", () => {
    expect(
      isSocialCrawler(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });
});
