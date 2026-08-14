// civic.digest/filter.ts — digest-renderable predicate, delegated to the
// single shared feed-worthiness classifier.
//
// Phase 3 (audit §2): this file used to be a SECOND, hand-maintained copy of
// the feed's inclusion rules ("MUST STAY IN SYNC with Feed.tsx…") and had
// already drifted — proposals/projects/conversations were absent from the
// digest, civic.process.created was hard-excluded, and every
// civic.process.started was mislabeled as a vote (the wordcloud bug). It now
// delegates to src/shared/feedActivity.ts, the same classifier the web feed
// uses, so the two can never diverge again. Reaching the feed's parity is now
// automatic: anything the feed shows, the digest shows, with the same kind.

import {
  classifyActivity,
  type ClassifierEvent,
} from "../../shared/feedActivity.js";
import type { DigestEvent, DigestItem, DigestItemKind } from "./models.js";

/**
 * Return true when an event should appear in a user's daily digest — exactly
 * when the shared classifier considers it feed-worthy. (DigestEvent is
 * structurally a ClassifierEvent.)
 */
export function isDigestRenderable(event: DigestEvent): boolean {
  return classifyActivity(event as ClassifierEvent) !== null;
}

/**
 * Discriminate an event into its digest item kind (the shared ActivityKind),
 * or null when the event isn't digest-renderable.
 */
export function classifyItemKind(event: DigestEvent): DigestItemKind | null {
  return classifyActivity(event as ClassifierEvent)?.kind ?? null;
}

/**
 * Canonical default sort: by section order (votes → results → meeting
 * summaries → announcements → word clouds → proposals → projects →
 * conversations), then by timestamp descending inside each kind. Kinds that
 * share a rendered section are adjacent in this order, so grouping in
 * service.ts preserves the timestamp sort within each section.
 */
const KIND_ORDER: Record<DigestItemKind, number> = {
  "vote-open": 0,
  "vote-results": 1,
  meeting: 2,
  announcement: 3,
  "announcement-author": 4,
  wordcloud: 5,
  proposal: 6,
  "proposal-closed": 7,
  "project-created": 8,
  "project-updated": 9,
  conversation: 10,
  "conversation-results": 11,
  brief: 12,
};

export function sortDigestItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => {
    const ka = KIND_ORDER[a.kind];
    const kb = KIND_ORDER[b.kind];
    if (ka !== kb) return ka - kb;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
