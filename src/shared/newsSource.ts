// How a post copied in by News Sync is shown (Adam, 2026-11-16; its own
// News item type since 2026-11-18, packages/civic.news_sync).
//
// Two settings name the hub's source, and the job copies both onto each
// item's `source` as it saves it:
//
//   plugin.news_sync.from_label   the "From …" line on each card. Empty means
//                                 "<place> Government", which is what synced
//                                 posts have always been labelled.
//   plugin.news_sync.pill_label   the pill on each card and the name of the
//                                 feed's filter for them ("County news",
//                                 "Government announcement"). Empty is "News".
//
// Each hub has one source, so the settings as they stand now name every item,
// including ones copied in before a change; the stored values stand in where
// the hub reads no settings.
//
// A source never marks a post urgent; an admin can pin one like any item.

/** The pill when a hub names none. */
export const DEFAULT_NEWS_PILL = "News";

/** The "From" label a hub's synced posts carry: its setting, else "<place> Government". */
export function newsFromLabel(setting: string | null | undefined, place: string | null | undefined): string {
  const own = setting?.trim();
  if (own) return own;
  return place ? `${place} Government` : "Local Government";
}

/** The pill a hub's synced posts carry: its setting, else "News". */
export function newsPillLabel(setting: string | null | undefined): string {
  return setting?.trim() || DEFAULT_NEWS_PILL;
}

/** What a synced post's `source` says about who it is from. */
export interface SyncedSourceView {
  /** "From" whom, or null when the post says nothing (then the author label stands in). */
  label: string | null;
}

/**
 * Read a `source` (null when there is none). Kept for the announcement
 * events stored before the split, whose `data.announcement.source` marks a
 * synced post (src/shared/feedActivity.ts).
 */
export function syncedSourceView(source: unknown): SyncedSourceView | null {
  if (!source || typeof source !== "object") return null;
  const s = source as { label?: unknown };
  return { label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : null };
}

/**
 * Who a synced post is from, as its card says it: the hub's From label as set
 * now, else what the post itself says (its own label, else its author label).
 */
export function syncedFrom(currentSetting: string | null | undefined, postFrom: string): string {
  return currentSetting?.trim() || postFrom;
}
