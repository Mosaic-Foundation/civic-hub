// The feed-meta contract: what a process type's feedMeta hook returns for the
// feed's cards (GET /feed's processMeta). In the process contract so a
// handler can produce it without importing the feed service (Architecture 2).

export interface FeedProcessMeta {
  title?: string;
  description?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  totalVotes?: number;
  commentsCount?: number;
  editCount?: number;
  lastEditedAt?: string | null;
  blockCount?: number;
  maxStartSeconds?: number | null;
  /** Announcement removed by a moderator — the client drops the card. */
  removed?: boolean;
}
