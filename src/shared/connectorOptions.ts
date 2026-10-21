// The connector ids a hub can choose for its meeting summaries and its news
// feed. Their own file so a process manifest can name them without importing
// the settings sections (which are built from the manifests).

/** Meeting-summary connector ids (src/modules/civic.meeting_summary/connectors). */
export const MEETING_CONNECTOR_OPTIONS = ["auto", "wix-cms", "minutes-page", "youtube-channel"] as const;
/** News-sync connector ids (src/modules/civic.news_sync/connectors). */
export const NEWS_CONNECTOR_OPTIONS = ["wix-cms"] as const;
