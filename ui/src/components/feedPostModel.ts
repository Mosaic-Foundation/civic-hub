// How a feed card is made from a civic event (split from FeedPost.tsx so that
// file holds only the component). Pure functions, no rendering.
import type { CivicEvent } from "../services/api";
import { typeDisplay } from "../config/navigation";
import { classifyActivity, type Activity, type ActivityKind } from "../../../src/shared/feedActivity";
import { feedKindUi } from "../processes";
import { summaryFromDescription } from "../processes/feedText";
import type { CardText } from "../processes/types";
import type { FeedPostView } from "./FeedPost";

/**
 * The few moments the type pill doesn't say by itself (Adam, 2026-10-14). A
 * new vote, proposal or project needs no word: the pill and the date say it.
 */
const ACTIVITY_NOTES: Partial<Record<ActivityKind, string>> = {
  "project-updated": "Update",
  "brief-response": "Official response",
  "vote-closed": "Results",
  "proposal-closed": "Results",
  "conversation-results": "Results",
};

/**
 * The process type an event is about: the `data.process.type` discriminator
 * an emitter stamps via emitEvent, with the legacy flat fallback. Undefined
 * for a legacy event with neither.
 */
export function eventProcessType(event: CivicEvent): string | undefined {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const nested = (data.process as { type?: unknown } | undefined)?.type;
  if (typeof nested === "string") return nested;
  const flat = (data as { process_type?: unknown }).process_type;
  if (typeof flat === "string") return flat;
  return undefined;
}

/**
 * Build a feed post from a civic event.
 *
 * Phase 3 — feed-worthiness, pill, kind, and href all come from the single
 * shared `classifyActivity` (src/shared/feedActivity.ts). This function no
 * longer discriminates process types by sniffing `data` shape; it only turns
 * the classifier's verdict into a renderable view, deriving the title and
 * summary (which need fetched per-process metadata) from the getters the Feed
 * container supplies. Returns null when the event is not feed-worthy.
 */
export function eventToPost(
  event: CivicEvent,
  getProcessDescription: (processId: string) => string | undefined,
  getProcessTitle: (processId: string) => string | undefined,
): FeedPostView | null {
  const activity = classifyActivity(event);
  if (!activity) return null;

  const { title, summary, authorName, engagement } = buildTitleSummary(
    activity,
    event,
    getProcessTitle,
    getProcessDescription,
  );

  return {
    id: event.id,
    title,
    engagement: engagement ?? null,
    // The type's own label (design A, navigation slice 2026-10-14): one
    // word per kind of thing, from the registry, so a plugin's type gets its
    // pill with no change here.
    pillLabel: typeDisplay(eventProcessType(event))?.label ?? activity.pill,
    note: ACTIVITY_NOTES[activity.kind] ?? null,
    pillKind: activity.kind,
    pillColor: activity.color,
    summary,
    timestamp: event.timestamp,
    href: activity.href,
    authorName: authorName ?? null,
    sample: event.sample,
  };
}

/**
 * Derive the title/summary/author for a card from its classified kind plus the
 * event payload and the lazily-fetched per-process metadata. Pure presentation
 * — the feed-worthiness decision already happened in classifyActivity, and
 * each kind's wording lives with its process type (ui/src/processes/).
 */
function buildTitleSummary(
  activity: Activity,
  event: CivicEvent,
  getTitle: (id: string) => string | undefined,
  getDescription: (id: string) => string | undefined,
): CardText {
  const id = event.process_id;
  const ui = feedKindUi(activity.kind);
  // A kind no module claims: no wording to give.
  if (!ui) return { title: "", summary: "" };
  return ui.card({
    activity,
    event,
    id,
    data: event.data as Record<string, unknown>,
    getTitle,
    getDescription,
    descSummary: summaryFromDescription(getDescription(id)),
  });
}
