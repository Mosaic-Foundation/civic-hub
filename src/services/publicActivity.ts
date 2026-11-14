// What happened on the hub in scope that anyone may see, in the order it was
// recorded: for a feature that tells people outside the hub (the fediverse
// feature's posts, 2026-11-14). The same items the public feed and the email
// digest show, by the same classifier (src/shared/feedActivity.ts), and the
// same exclusions as the digest: no sample content, no restricted events, no
// process that is not public (archived, waiting for review, its plugin off),
// no removed announcement.
//
// Names nobody: an item is its process's title, kind and page, never who
// acted. A reader that wants more reads the hub.

import { getEventsSince } from "../events/eventStore.js";
import { getHiddenProcessIds, getProcess } from "./processService.js";
import { processDetailPath } from "../processes/registry.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { classifyActivity, type ActivityKind, type ClassifierEvent } from "../shared/feedActivity.js";

export interface PublicActivityItem {
  event_id: string;
  /** When the event was recorded (the cursor), ISO. */
  recorded_at: string;
  event_type: string;
  /** The feed's kind ("vote-open", "brief") and pill ("Vote"). */
  kind: ActivityKind;
  pill: string;
  process_id: string;
  process_type: string;
  title: string;
  /** The process's page on the hub, absolute. */
  url: string;
}

export interface PublicActivityPage {
  items: PublicActivityItem[];
  /** The last event looked at (shown or not), for the next call's `since`; null when none. */
  cursor: string | null;
}

/**
 * Public items recorded after `since` (ISO), oldest first, at most `limit`
 * events looked at. `kinds`, when given, keeps only those feed kinds.
 */
export async function publicActivitySince(
  since: string,
  options: { limit?: number; kinds?: ReadonlySet<string> } = {},
): Promise<PublicActivityPage> {
  const limit = options.limit ?? 500;
  const events = (await getEventsSince(since)).slice(0, limit);
  if (events.length === 0) return { items: [], cursor: null };
  const hidden = await getHiddenProcessIds();
  const items: PublicActivityItem[] = [];
  for (const e of events) {
    if (e.meta?.visibility === "restricted" || !e.process_id || hidden.has(e.process_id)) continue;
    const activity = classifyActivity(e as ClassifierEvent);
    if (!activity || (options.kinds && !options.kinds.has(activity.kind))) continue;
    const process = await getProcess(e.process_id);
    if (!process || process.isSample) continue;
    const moderation = (process.state as { moderation?: { removed?: unknown } } | null | undefined)?.moderation;
    if (moderation?.removed) continue;
    const type = process.definition.type;
    items.push({
      event_id: e.id,
      recorded_at: e.recorded_at,
      event_type: e.event_type,
      kind: activity.kind,
      pill: activity.pill,
      process_id: process.id,
      process_type: type,
      title: process.title,
      url: `${uiBaseUrl()}${processDetailPath(type, process.id)}`,
    });
  }
  return { items, cursor: events[events.length - 1]!.recorded_at };
}
