// How a post copied in by News Sync is shown (Adam, 2026-11-16).
//
// News Sync saves each post as an announcement with a `source` on it (who
// synced it, from where). Two settings decide how those posts read, and the
// job copies both onto each post's `source` as it saves it:
//
//   plugin.news_sync.from_label   the "From …" line on each card. Empty means
//                                 "<place> Government", which is what synced
//                                 posts have always been labelled.
//   plugin.news_sync.show_as      "news" (the default): a News pill and the
//                                 feed's News filter. "announcement": shown as
//                                 an announcement, as before.
//
// A source never marks a post urgent or pinned: urgent is for whoever posts an
// announcement, pinned is for admins (src/shared/announcementBoard.ts), and an
// admin can pin a synced post like any other.
//
// Posts synced before this change carry neither field. They read as News, and
// their "From" line is the author label the job gave them (author_role).

/** The values `plugin.news_sync.show_as` may hold. Ids, not copy. */
export const NEWS_SHOW_AS_OPTIONS = ["news", "announcement"] as const;
export type NewsShowAs = (typeof NEWS_SHOW_AS_OPTIONS)[number];

/** How the Plugins page names each choice. */
export const NEWS_SHOW_AS_LABELS: Readonly<Record<NewsShowAs, string>> = {
  news: "News",
  announcement: "Announcement",
};

/** A setting's value as a show-as choice: anything but "announcement" is News. */
export function newsShowAs(raw: unknown): NewsShowAs {
  return raw === "announcement" ? "announcement" : "news";
}

/** The "From" label a hub's synced posts carry: its setting, else "<place> Government". */
export function newsFromLabel(setting: string | null | undefined, place: string | null | undefined): string {
  const own = setting?.trim();
  if (own) return own;
  return place ? `${place} Government` : "Local Government";
}

/** What a synced post's `source` says about how it is shown. */
export interface SyncedSourceView {
  /** "From" whom, or null when the post says nothing (then the author label stands in). */
  label: string | null;
  showAs: NewsShowAs;
}

/** Read a post's `source` (null when it was not synced). */
export function syncedSourceView(source: unknown): SyncedSourceView | null {
  if (!source || typeof source !== "object") return null;
  const s = source as { label?: unknown; show_as?: unknown };
  return {
    label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : null,
    showAs: newsShowAs(s.show_as),
  };
}
