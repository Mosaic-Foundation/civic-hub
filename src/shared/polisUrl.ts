// The Polis server a hub uses when it has not named its own
// (plugin.conversation.polis_url). One constant for the server and the hub
// UI: the sample seed left a new hub's conversation without this fallback
// while the start action and the UI both had it (fixed 2026-10-06).
export const DEFAULT_POLIS_URL = "https://polis.civic.social";
