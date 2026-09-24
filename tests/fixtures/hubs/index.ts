// FIXTURE DATA — hubs for unit tests.
//
// Two hubs shaped like the ones on the dev deployment: Floyd, the first real
// hub, and Athens, the fictional demo. The point of having both is to prove a
// value reaches the hub that owns it and not the other one, so Floyd's values
// here are Floyd's real configuration, copied from config/hubs/floyd/ — the
// seed source — and deliberately NOT imported from it: a test that read the
// seed file would pass whatever the seed said.
//
// Place names are allowed here and nowhere in src/ or ui/src/. See
// scripts/check-place-names.ts.

import type { Hub } from "../../../src/models/hub.js";
import type { SettingsMap } from "../../../src/db/hubSettingsStore.js";

function hub(fields: Partial<Hub> & Pick<Hub, "id" | "hostname" | "name">): Hub {
  return {
    protocol_hub_id: `civic-hub-${fields.id}`,
    jurisdiction_code: null,
    jurisdiction_name: null,
    space_did: `did:web:${fields.hostname}`,
    space_type: "civic-hub",
    status: "active",
    mode: "live",
    created_at: "2026-09-22T00:00:00Z",
    updated_at: "2026-09-22T00:00:00Z",
    ...fields,
  };
}

export const FLOYD_HUB: Hub = hub({
  id: "floyd",
  protocol_hub_id: "civic-hub-local",
  hostname: "floyd.civic.social",
  name: "Floyd Civic Hub",
  jurisdiction_code: "us-va-floyd",
  jurisdiction_name: "Floyd County, Virginia",
  mode: "beta",
});

export const ATHENS_HUB: Hub = hub({
  id: "athens",
  hostname: "athens.example",
  name: "Athens Civic Hub",
  jurisdiction_code: "us-va-athens",
  jurisdiction_name: "Town of Athens, Virginia",
  mode: "demo",
});

/** A hub with no civic geography and no settings at all. */
export const BARE_HUB: Hub = hub({
  id: "bare",
  hostname: "bare.example",
  name: "Bare Hub",
});

export const FLOYD_NEWS_FEED_URL = "https://www.floydcova.gov/blog-feed.xml";
export const FLOYD_MEETINGS_URL = "https://www.floydcova.gov/agendas-minutes";
export const FLOYD_YOUTUBE_CHANNEL_ID = "UCxyzO8F2UfiN1NVOax2s27Q";

export const ATHENS_NEWS_FEED_URL = "https://www.athens.example/blog-feed.xml";
export const ATHENS_MEETINGS_URL = "https://www.athens.example/council-minutes";

export const FLOYD_SETTINGS: SettingsMap = {
  "copy.governing_body_name": "Board of Supervisors",
  "plugin.news_sync.connector": "wix-cms",
  "plugin.news_sync.source_url": FLOYD_NEWS_FEED_URL,
  "plugin.meeting_summary.connector_id": "auto",
  "plugin.meeting_summary.source_url": FLOYD_MEETINGS_URL,
  "plugin.meeting_summary.youtube_channel_id": FLOYD_YOUTUBE_CHANNEL_ID,
  "plugin.meeting_summary.type_exclude": "EMS Board,EMS Meeting",
};

export const ATHENS_SETTINGS: SettingsMap = {
  "copy.governing_body_name": "Town Council",
  "plugin.news_sync.connector": "wix-cms",
  "plugin.news_sync.source_url": ATHENS_NEWS_FEED_URL,
  "plugin.meeting_summary.connector_id": "wix-cms",
  "plugin.meeting_summary.source_url": ATHENS_MEETINGS_URL,
  "plugin.meeting_summary.title_filter": "Town Council",
};

/**
 * Every env var the news-sync and meeting-summary settings fall back to.
 * Tests clear them, so a developer's .env cannot make a hub look configured.
 */
export const PLUGIN_ENV_FALLBACKS = [
  "FLOYD_NEWS_SYNC_ENABLED",
  "FLOYD_NEWS_SOURCE_URL",
  "FLOYD_NEWS_SYNC_MAX_PER_RUN",
  "MEETING_SUMMARY_ENABLED",
  "MEETING_SOURCE_URL",
  "MEETING_CONNECTOR_ID",
  "MEETING_EXTRACTION_INSTRUCTIONS",
  "MEETING_TITLE_FILTER",
  "MEETING_TYPE_EXCLUDE",
  "MEETING_WIX_COLLECTION",
  "MEETING_YOUTUBE_CHANNEL_ID",
  "MEETING_SUMMARY_AUTO_PUBLISH",
  "MEETING_SUMMARY_CUTOFF_DATE",
  "MEETING_SUMMARY_MAX_PER_RUN",
  "VITE_HUB_GOVERNING_BODY_NAME",
] as const;
