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
import { activityIdOf, processIriOf } from "../events/activitySerializer.js";
import { buildShareMeta } from "./shareMeta.js";

/** The first `*image_alt` the process carries, beside its image. */
function imageAlt(state: unknown): string | null {
  const bags = [state, (state as { content?: unknown } | null)?.content];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
      if (/image_alt$/.test(k) && typeof v === "string" && v.trim()) return v.trim().slice(0, 1500);
    }
  }
  return null;
}

function absolute(url: string): string | null {
  try {
    const u = new URL(url, `${uiBaseUrl()}/`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

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
  /**
   * The same item's identities on the hub's civic activity stream (GET
   * /events): the activity's id, and the process IRI every activity about it
   * names as its `context`. For a reader that follows both to tell them apart.
   */
  activity_iri: string;
  process_iri: string;
  /**
   * What the item's page says about it in a link preview
   * (src/services/shareMeta.ts): its description, plain text, a couple of
   * sentences at most and ending "…" when cut; and its image, absolute, with
   * its description when the item has one. Null when there is none.
   */
  description: string | null;
  image: { url: string; alt: string | null } | null;
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
    const share = buildShareMeta(processDetailPath(type, process.id), process);
    const imageUrl = share?.image ? absolute(share.image) : null;
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
      activity_iri: activityIdOf(e),
      process_iri: processIriOf(e) ?? `${uiBaseUrl()}/process/${process.id}`,
      description: share && share.description !== share.title ? share.description : null,
      image: imageUrl ? { url: imageUrl, alt: imageAlt(process.state) } : null,
    });
  }
  return { items, cursor: events[events.length - 1]!.recorded_at };
}
