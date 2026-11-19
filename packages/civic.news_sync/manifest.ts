// news: the process type's manifest (src/processes/manifest.ts; ADR-009).
// Plain data: the registry, the wire, the settings page, the feed and the UI
// are built from it. The handler (./handler.ts) runs its actions.
//
// News Sync is its own plugin (Adam, 2026-11-18): its posts are News items,
// not announcements, so it works with Announcements switched off and
// Announcements works with it off. Its job ("news_sync", ./job.ts) is its own
// too, under this plugin's switch.

import { defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";
import { NEWS_CONNECTOR_OPTIONS } from "./sync/connectors/options.js";
import { newsCard } from "./feed.js";

/**
 * What a News item is (src/processes/descriptor.ts). The news sync job
 * creates it, emits result_published and sets it to finalized in one run.
 * Nobody posts or edits one by hand. It has no process actions.
 *
 * Lifecycle: born active and finalized in the same run.
 */
const descriptor = defineDescriptor({
  type: "civic.news",
  version: "0.1",
  tier: 1,
  plugin: "news_sync",
  states: ["active", "finalized"],
  initial_status: "active",
  actions: [],
  emits: ["civic.process.result_published"],
  creation: { resident: null, admin: false, system: true },
  deadline: null,
  brief: false,
  tables: [],
  outside_services: [],
  examples: {},
  display: { label: "News", plural: "News", icon: "announcement" },
});

export const NEWS_MANIFEST = defineManifest({
  descriptor,
  color: "news",
  // Its colours' defaults (kernel step 4: each plugin carries its own). The
  // Civic Hub's palette lists the same keys (a few following its base colours), and wins.
  colors: [
    { key: "news", label: "News", fg: "#34495a", bg: "#e3e8ec", dark: { fg: "#a9bccb", bg: "#232b31" } },
  ],
  detailPath: (id) => `/news/${id}`,
  requiredSchema: [],
  tables: [],
  jobs: [
    {
      id: "news_sync",
      plugin: "news_sync",
      path: "/news-sync/run",
      schedule: "0 12 * * *",
      description: "News feed to News items, per hub that configured a feed",
      // Production's vercel.json on `main` schedules the old name until the
      // multi-tenant cutover deploys this list; removed then, together with its
      // entry in scripts/place-name-allowlist.txt.
      deprecatedPaths: ["/floyd-news-sync/run"],
    },
  ],
  pluginSection: {
    order: 90,
    name: "News sync",
    what: "Posts copied in from another site's news feed, each shown on the feed with where it came from.",
    fields: [
      {
        key: "plugin.news_sync.connector", kind: "choice", options: NEWS_CONNECTOR_OPTIONS,
        help: { text: "The kind of news feed to copy from. Today the only choice is a Wix blog feed. Both this and the feed address must be set for news sync to run.", page: "/reference/plugins", anchor: "plugin-news-sync-connector" },
      },
      {
        key: "plugin.news_sync.source_url", kind: "url",
        help: { text: "The address of the news feed to copy from. Left empty, news sync does nothing.", page: "/reference/plugins", anchor: "plugin-news-sync-source-url" },
      },
      {
        key: "plugin.news_sync.from_label", kind: "text", maxLength: 80,
        help: { text: "Shown on each copied post as \"From ...\", so residents know where it came from. Left empty, it reads as your place's name followed by \"Government\".", page: "/reference/plugins", anchor: "plugin-news-sync-from-label", pending: true },
      },
      {
        key: "plugin.news_sync.pill_label", kind: "text", maxLength: 40,
        help: { text: "The tag on each copied post in the feed, and the name of the feed's filter for them, such as \"County news\". Left empty, it reads \"News\". An admin can pin any post from its page.", page: "/reference/plugins", anchor: "plugin-news-sync-pill-label", pending: true },
      },
    ],
    words: ["rss", "news feed", "feed import", "import news", "atom"],
    help: { text: "Copies posts from another site's news feed, such as your government's, into the feed as News items with where they came from. It needs a feed address and nothing else switched on.", page: "/reference/plugins", anchor: "plugins-news-sync" },
    // "Needs setup" until it has a feed (src/shared/pluginSetup.ts): what the
    // news-sync job reads, both needed.
    setup: {
      keys: ["plugin.news_sync.connector", "plugin.news_sync.source_url"],
      configured: (s) => !!s("plugin.news_sync.connector")?.trim() && !!s("plugin.news_sync.source_url")?.trim(),
      missing: "Choose a connector and add the news feed's address below.",
    },
    search: {
      "plugin.news_sync.connector": { label: "Kind of feed", words: ["rss", "atom", "news feed type"] },
      "plugin.news_sync.source_url": { label: "Feed address", words: ["rss url", "feed url", "news url"] },
      "plugin.news_sync.from_label": { label: "From label", words: ["source name", "from", "news source", "label"] },
      "plugin.news_sync.pill_label": { label: "Pill label", words: ["news", "pill", "category", "tag", "label", "filter"] },
    },
  },
  activities: {},
  // Who a participant's name is disclosed to: nobody takes part, and the
  // actor is the job.
  disclosure: "public",
  // What the hub's analytics counts (ADR-016): nothing anyone did here.
  participation: {
    participation: "none",
    creation: ["civic.process.created"],
    closing: [],
    outcome: ["civic.process.result_published"],
  },
  publicPayload: {
    "civic.process.result_published": ["news"],
  },
  feed: {
    cards: [{ event: "civic.process.result_published", legacy: [{ field: "news", is: "present" }], card: { surface: "news", color: "news", fromPayload: newsCard } }],
  },
  capabilities: {
    activities: { emit: ["civic.process.result_published"], listen: [] },
    state: { read: ["own-process"], write: ["own-process"], tables: [] },
    adapters: ["ai", "web"],
    network: { egress: [] },
    identity: { claims: ["participant-ref"] },
    ui: { surfaces: ["process-page", "feed-card", "settings-panel"] },
  },
});

export default NEWS_MANIFEST;
