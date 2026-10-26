// civic.announcement: a post from an official or admin on the feed
// (manifest: ./manifest.ts).

import { Link } from "react-router-dom";
import { AnnouncementPage, PostAnnouncement } from "../../ui/src/lazyPages";
import { getAnnouncement } from "../../ui/src/services/api";
import { relativeTime } from "../../ui/src/utils/dates";
import type { FeedKindUi, ProcessUi } from "../../ui/src/processes/types";

const announcementKind: FeedKindUi = {
  card: ({ id, data, getTitle, descSummary }) => {
    const ann = data.announcement as
      | { title?: string; author_display_name?: string | null }
      | undefined;
    return {
      title: ann?.title ?? getTitle(id) ?? "Announcement",
      summary: descSummary,
      authorName: ann?.author_display_name ?? null,
    };
  },
  // body serves as the feed summary. Slice 11: when an admin has
  // removed the announcement, push its id into removedProcessIds so the
  // post-builder filter drops it. The presence of the removal still
  // cooperates with the meta cache (resolved to {}) so we don't refetch.
  meta: (id, ctx) =>
    getAnnouncement(id).then((a) => {
      if (a.moderation?.removed) {
        ctx.markRemoved(id);
        return null;
      }
      return {
        title: a.title,
        description: a.body,
        imageUrl: a.image_url ?? null,
        imageAlt: a.image_alt ?? null,
        editCount: a.edit_count ?? 0,
        lastEditedAt: a.last_edited_at ?? null,
      };
    }),
  engagement: (meta) => {
    const c = meta.editCount ?? 0;
    if (c > 0 && meta.lastEditedAt) {
      return `Edited ${relativeTime(meta.lastEditedAt)}`;
    }
    return null;
  },
};

const announcementUi: ProcessUi = {
  type: "civic.announcement",
  routes: [
    { path: "/announcement/new", element: <PostAnnouncement /> },
    { path: "/announcement/:id/edit", element: <PostAnnouncement /> },
    { path: "/announcement/:id", element: <AnnouncementPage /> },
  ],
  feed: {
    announcement: announcementKind,
    "announcement-author": announcementKind,
  },
  settingsPanel: () => (
    <p className="form-hint">
      Who may post is set under <Link to="/admin/settings/officials">Officials</Link>.
      Admins can always post.
    </p>
  ),
};

export default announcementUi;
