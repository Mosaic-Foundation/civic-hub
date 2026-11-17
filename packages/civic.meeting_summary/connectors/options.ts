// The connector ids a hub can choose for its meeting summaries: the settings
// page's choice ("auto" tries each). Their own file so the manifest can name
// them without importing the connectors.

export const MEETING_CONNECTOR_OPTIONS = ["auto", "wix-cms", "minutes-page", "youtube-channel"] as const;
