// civic.vote_results: the legacy published results of a vote
// (manifest: src/modules/civic.vote_results/manifest.ts). Belongs to the vote plugin.

import { AdminVoteResults, VoteResults } from "../lazyPages";
import hub from "../config/hub";
import { getPublicVoteResults } from "../services/api";
import { formatCount } from "./feedText";
import type { ProcessUi } from "./types";

export const voteResultsUi: ProcessUi = {
  type: "civic.vote_results",
  routes: [
    // Legacy vote-results admin (existing published vote briefs keep their
    // review screen); the Briefs tab now points at /admin/briefs.
    { path: "/admin/vote-results", element: <AdminVoteResults />, admin: true },
    { path: "/admin/vote-results/:id", element: <AdminVoteResults />, admin: true },
    { path: "/vote-results/:id", element: <VoteResults /> },
  ],
  feed: {
    "vote-results": {
      card: ({ id, data, getTitle }) => {
        const headline =
          typeof data.headline_result === "string" ? data.headline_result : "";
        return {
          title: getTitle(id) ?? "Vote results",
          // Summary carries context; the participation/comment counts live on
          // the engagement line so the two don't both say "N residents voted".
          summary:
            headline ||
            (hub.governing_body_short
              ? `Delivered to the ${hub.governing_body_name || hub.governing_body_short}.`
              : ""),
        };
      },
      meta: (id) =>
        getPublicVoteResults(id).then((vr) => ({
          title: vr.title,
          description: vr.admin_notes ?? undefined,
          imageUrl: vr.image_url ?? null,
          imageAlt: vr.image_alt ?? null,
          totalVotes: vr.participation_count,
          commentsCount: vr.comments?.length ?? 0,
        })),
      titleNeedsMeta: true,
      engagement: (meta) => {
        const n = meta.totalVotes ?? 0;
        const m = meta.commentsCount ?? 0;
        if (n === 0 && m === 0) return null;
        const parts: string[] = [];
        if (n > 0) {
          parts.push(`${formatCount(n)} ${hub.noun(n)} voted`);
        }
        if (m > 0) {
          const noun = m === 1 ? "comment" : "comments";
          parts.push(`${formatCount(m)} ${noun}`);
        }
        return parts.join(" · ");
      },
    },
  },
};
