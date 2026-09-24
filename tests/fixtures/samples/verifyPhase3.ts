// FIXTURE DATA — sample announcement event data and hub context used by
// scripts/verifyPhase3.ts to exercise the feed classifier + digest
// assembler over a representative event set.

export const VERIFY_PHASE3_SYNCED_ANNOUNCEMENT_DATA = {
  announcement: {
    author_role: "Floyd County Government",
    source: {
      origin: "news-sync",
      connector: "wix-cms",
      share_url: "https://www.floydcova.gov/post/sample",
      ingested_at: "2026-09-01T00:00:00Z",
    },
  },
};

export const VERIFY_PHASE3_HUB = {
  hub_name: "Floyd Civic Hub",
  ui_base_url: "https://hub.example",
  postal_address: "Floyd, VA",
  unsubscribe_url: "https://hub.example/u",
  manage_subscriptions_url: "https://hub.example/settings",
};
