// civic.meeting_summary — one hub's source configuration, from its settings
//
// Every value here is `plugin.meeting_summary.*` for the hub in scope (plus
// its governing body's name, for prompt examples). None has a default that
// names a place: an unset source is an unconfigured hub, not Floyd's. Floyd's
// URL, channel and exclusion list are seed data in config/hubs/floyd/.
//
// Kept apart from the 1,500-line controller so the rule can be tested without
// a database or a model.

import { getSettingSync, isPluginEnabledSync } from "../../services/hubSettings.js";
import { KEYS } from "../../models/hubSettings.js";
import {
  CONNECTORS,
  PAGE_CONNECTOR_IDS,
  canonicalConnectorId,
  isConfigured,
} from "./connectors/index.js";
import { resolveEffectiveInstructions } from "./prompts.js";
import type { MeetingSummaryConfig } from "./models.js";

/**
 * "auto" tries every connector whose configuration is present, in descending
 * order of source quality, and uses the first that returns meetings. That is
 * what makes "point it at your government's site" true across platforms
 * without the operator having to know which kind of site they have.
 */
export const DEFAULT_CONNECTOR_ID = "auto";

export type MeetingSummaryResolution =
  | { status: "ready"; connectorId: string; cfg: MeetingSummaryConfig }
  /** Switched off, or no source at all. Not a failure: most hubs have none. */
  | { status: "skipped"; reason: string }
  /** Configured wrongly. A failure, and the cron alerts on it. */
  | { status: "invalid"; reason: string; connectorId: string };

/**
 * Resolve meeting summaries for the hub in scope.
 *
 * `plugin.meeting_summary.enabled` defaults to on like every plugin, so a hub
 * uses meeting summaries when it has named a source — a page or a channel.
 * Neither → skipped, which is what lets the cron run over every hub without
 * paging the admins of the ones that never set it up. A connector chosen
 * explicitly but missing the source it needs → invalid.
 */
export function resolveMeetingSummaryConfig(model: string): MeetingSummaryResolution {
  if (!isPluginEnabledSync("meeting_summary")) {
    return { status: "skipped", reason: "meeting summary disabled" };
  }

  const configured = getSettingSync(KEYS.PLUGIN_MEETING_CONNECTOR_ID)?.trim() || DEFAULT_CONNECTOR_ID;
  const connectorId = canonicalConnectorId(configured);
  if (connectorId !== DEFAULT_CONNECTOR_ID && !CONNECTORS[connectorId]) {
    return {
      status: "invalid",
      connectorId,
      reason:
        `Unknown ${KEYS.PLUGIN_MEETING_CONNECTOR_ID} "${configured}". ` +
        `Known: ${DEFAULT_CONNECTOR_ID}, ${Object.keys(CONNECTORS).join(", ")}`,
    };
  }

  const cfg: MeetingSummaryConfig = {
    source_url: getSettingSync(KEYS.PLUGIN_MEETING_SOURCE_URL)?.trim() ?? "",
    channel_id: getSettingSync(KEYS.PLUGIN_MEETING_YOUTUBE_CHANNEL_ID)?.trim() ?? "",
    title_filter: getSettingSync(KEYS.PLUGIN_MEETING_TITLE_FILTER)?.trim() ?? "",
    type_exclude: getSettingSync(KEYS.PLUGIN_MEETING_TYPE_EXCLUDE)?.trim() ?? "",
    collection_name: getSettingSync(KEYS.PLUGIN_MEETING_WIX_COLLECTION)?.trim() ?? "",
    extraction_instructions: resolveEffectiveInstructions(
      getSettingSync(KEYS.PLUGIN_MEETING_EXTRACTION_INSTRUCTIONS) ?? "",
    ),
    model,
    governing_body_name: getSettingSync(KEYS.COPY_GOVERNING_BODY_NAME)?.trim() || undefined,
  };

  if (connectorId === DEFAULT_CONNECTOR_ID) {
    if (!cfg.source_url && !cfg.channel_id) {
      return { status: "skipped", reason: "meeting summary not configured" };
    }
    return { status: "ready", connectorId, cfg };
  }

  if (!isConfigured(connectorId, cfg)) {
    return {
      status: "invalid",
      connectorId,
      reason: PAGE_CONNECTOR_IDS.has(connectorId)
        ? `${KEYS.PLUGIN_MEETING_SOURCE_URL} must be set for the "${connectorId}" connector.`
        : `${KEYS.PLUGIN_MEETING_YOUTUBE_CHANNEL_ID} must be set for the "${connectorId}" connector.`,
    };
  }
  return { status: "ready", connectorId, cfg };
}
