// The connector ids a hub can choose for its news feed. Their own file so the
// hub's features list can name them without importing the settings sections
// (which are built from the manifests). Meeting summaries keeps its own
// (packages/civic.meeting_summary/connectors/options.ts).

/** News-sync connector ids (src/modules/civic.news_sync/connectors). */
export const NEWS_CONNECTOR_OPTIONS = ["wix-cms"] as const;
