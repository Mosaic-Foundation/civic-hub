// features/digest/filter.ts — digest-renderable predicate, delegated to the
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
  DECLARED_FEED_KINDS,
  type ClassifierEvent,
} from "../../src/shared/feedActivity.js";
import { SPACE_KINDS, SPACE_PALETTE } from "../../src/shared/spacePalette.js";
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
 * Canonical default sort: by each kind's `order` in the space type's palette
 * (src/shared/spacePalette.ts), then a package's declared kinds (A5) in load
 * order, then by timestamp descending inside each kind. Kinds that share a
 * rendered section are adjacent in this order, so grouping in service.ts
 * preserves the timestamp sort within each section.
 */
const AFTER_SPACE = Math.max(-1, ...SPACE_PALETTE.kinds.map((k) => k.order)) + 1;
const DECLARED_ORDER: ReadonlyMap<string, number> = new Map([...DECLARED_FEED_KINDS.keys()].map((k, i) => [k, AFTER_SPACE + i]));
const kindOrder = (kind: string): number => SPACE_KINDS.get(kind)?.order ?? DECLARED_ORDER.get(kind) ?? 99;

export function sortDigestItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => {
    const ka = kindOrder(a.kind);
    const kb = kindOrder(b.kind);
    if (ka !== kb) return ka - kb;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
