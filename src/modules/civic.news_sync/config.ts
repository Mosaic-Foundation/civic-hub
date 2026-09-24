// civic.news_sync — one hub's configuration, from its settings and nothing else
//
// Kept apart from the controller so the rule it enforces can be tested without
// a database: the connector and the feed come from the hub in scope, there are
// no defaults, and a hub that has configured neither is simply not using the
// plugin.

import { getSettingSync, isPluginEnabledSync } from "../../services/hubSettings.js";
import { KEYS } from "../../models/hubSettings.js";
import { NEWS_CONNECTORS, newsConnectorFor } from "./connectors/index.js";
import type { NewsSyncConfig } from "./models.js";

const DEFAULT_MAX_PER_RUN = 5;

export type NewsSyncResolution =
  /** Configured and ready to run. */
  | { status: "ready"; cfg: NewsSyncConfig; maxPerRun: number }
  /** Switched off, or never set up. Not a failure: most hubs have no feed. */
  | { status: "skipped"; reason: string }
  /** Set up wrongly. A failure — the operator meant something and it will not run. */
  | { status: "invalid"; reason: string };

/**
 * Resolve news sync for the hub in scope.
 *
 * `plugin.news_sync.enabled` defaults to on, like every plugin, so "enabled"
 * alone does not mean a hub wants news: a hub uses news sync when it has named
 * a connector or a feed. Neither → skipped. One without the other → invalid,
 * because that is a half-finished setup rather than an absent one.
 */
export function resolveNewsSyncConfig(): NewsSyncResolution {
  if (!isPluginEnabledSync("news_sync")) {
    return { status: "skipped", reason: "news sync disabled" };
  }

  const connector = getSettingSync(KEYS.PLUGIN_NEWS_SYNC_CONNECTOR)?.trim() ?? "";
  const source_url = getSettingSync(KEYS.PLUGIN_NEWS_SYNC_SOURCE_URL)?.trim() ?? "";

  if (!connector && !source_url) {
    return { status: "skipped", reason: "news sync not configured" };
  }
  if (!connector) {
    return {
      status: "invalid",
      reason:
        `${KEYS.PLUGIN_NEWS_SYNC_SOURCE_URL} is set but ${KEYS.PLUGIN_NEWS_SYNC_CONNECTOR} ` +
        `is not. Known connectors: ${Object.keys(NEWS_CONNECTORS).join(", ")}.`,
    };
  }
  if (!newsConnectorFor(connector)) {
    return {
      status: "invalid",
      reason:
        `Unknown ${KEYS.PLUGIN_NEWS_SYNC_CONNECTOR} "${connector}". ` +
        `Known: ${Object.keys(NEWS_CONNECTORS).join(", ")}.`,
    };
  }
  if (!source_url) {
    return {
      status: "invalid",
      reason: `${KEYS.PLUGIN_NEWS_SYNC_SOURCE_URL} must be set for the "${connector}" connector.`,
    };
  }

  return { status: "ready", cfg: { connector, source_url }, maxPerRun: maxPerRun() };
}

function maxPerRun(): number {
  const raw = getSettingSync(KEYS.PLUGIN_NEWS_SYNC_MAX_PER_RUN)?.trim();
  if (!raw) return DEFAULT_MAX_PER_RUN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PER_RUN;
  return Math.floor(n);
}
