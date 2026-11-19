// The connector ids a hub can choose for its news feed, for the manifest's
// settings field (../../manifest.ts). Their own file so the manifest names them
// without loading the connectors (cheerio and all).

/** News-sync connector ids (./index.ts). */
export const NEWS_CONNECTOR_OPTIONS = ["wix-cms"] as const;
