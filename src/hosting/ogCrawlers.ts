// Which requests vercel.json sends to the share-card function (api/og.ts)
// rather than straight to the CDN's index.html (hosting layer, ADR-012;
// audit F6). Only a crawler can use a card; a browser gets the static app at
// once, and no function runs for it.
//
// The route matches a SUPERSET of the agents api/og.ts answers with a card
// (CRAWLER_RE there): an agent the route sends that og.ts does not recognise
// gets index.html from og.ts, exactly as every request did before. Case-
// insensitive, written as character classes so the router needs no flag.
// tests/unit/ogCrawlers.test.ts pins vercel.json to ogRoutePattern().

/** Agents routed to api/og.ts: og.ts's own list, and the other link-preview and search crawlers. */
export const OG_ROUTE_AGENTS = [
  "facebookexternalhit",
  "facebot",
  "meta-externalagent",
  "meta-externalfetcher",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "whatsapp",
  "discordbot",
  "telegrambot",
  "applebot",
  "pinterest",
  "embedly",
  "quora",
  "vkshare",
  "w3c_validator",
  "googlebot",
  "bingbot",
  "redditbot",
  "iframely",
  "skypeuripreview",
  "mastodon",
  "bluesky",
] as const;

function anyCase(token: string): string {
  return [...token].map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
}

/** The `has: user-agent` value in vercel.json's /api/og rewrites. */
export function ogRoutePattern(): string {
  return `.*(${OG_ROUTE_AGENTS.map(anyCase).join("|")}).*`;
}
