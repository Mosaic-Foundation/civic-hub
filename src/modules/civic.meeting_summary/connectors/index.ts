// civic.meeting_summary — connector registry
//
// Supporting a new publishing platform is a new module in this folder plus one
// entry here. Moved out of the controller on 2026-09-24 so the cron, the
// config resolver and scripts/diagnoseMeetingSummary.ts share one list rather
// than three copies of it.
//
//   wix-cms          Reads the CMS collection behind a Wix page. Structured
//                    rows, works even when the page renders client-side.
//                    Needs plugin.meeting_summary.source_url.
//   minutes-page     Generic HTML + Claude reader. Works on ANY
//                    server-rendered listing page, whatever engine — the
//                    universal fallback. Needs plugin.meeting_summary.source_url.
//   youtube-channel  Reads a government's YouTube channel feed. Recordings
//                    only, no documents. Needs
//                    plugin.meeting_summary.youtube_channel_id.

import type { MeetingSourceConnector, MeetingSummaryConfig } from "../models.js";
import { wixCmsConnector } from "./wixCms.js";
import { minutesPageConnector } from "./minutesPage.js";
import { youtubeChannelConnector } from "./youtubeChannel.js";

export const CONNECTORS: Readonly<Record<string, MeetingSourceConnector>> = {
  [wixCmsConnector.id]: wixCmsConnector,
  [minutesPageConnector.id]: minutesPageConnector,
  [youtubeChannelConnector.id]: youtubeChannelConnector,
};

/**
 * Ids a connector was registered under before it was renamed. A hub row or
 * env var written earlier may still hold one, and must keep selecting the
 * same connector. DEPRECATED: remove after the multi-tenant cutover rewrites
 * the rows, together with its entry in scripts/place-name-allowlist.txt.
 */
const RENAMED_CONNECTOR_IDS: Readonly<Record<string, string>> = {
  "floyd-minutes-page": minutesPageConnector.id,
};

/** The current id for a configured id, following a rename. */
export function canonicalConnectorId(id: string): string {
  return RENAMED_CONNECTOR_IDS[id] ?? id;
}

/** Connectors that read a page and therefore require source_url. */
export const PAGE_CONNECTOR_IDS: ReadonlySet<string> = new Set([
  wixCmsConnector.id,
  minutesPageConnector.id,
]);

/**
 * The order "auto" tries connectors in — best source first.
 *
 * Structured data beats prompt-driven HTML extraction (exact fields, no model
 * drift, full history). Documents beat recordings, because minutes are the
 * authoritative record and a transcript is a fallback. A connector whose
 * configuration is absent is skipped, not failed.
 */
export const AUTO_ORDER: readonly string[] = [
  wixCmsConnector.id,
  minutesPageConnector.id,
  youtubeChannelConnector.id,
];

/** Whether a connector has enough configuration to be worth attempting. */
export function isConfigured(id: string, cfg: MeetingSummaryConfig): boolean {
  if (PAGE_CONNECTOR_IDS.has(id)) return Boolean(cfg.source_url);
  if (id === youtubeChannelConnector.id) return Boolean(cfg.channel_id);
  return true;
}
