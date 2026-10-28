// civic.brief: the published record of what residents decided, sent to
// officials (manifest: ./manifest.ts).

import { Link, Navigate, useParams } from "react-router-dom";
import hub from "../../ui/src/config/hub";
import { getPublicBrief } from "../../ui/src/services/api";
import { formatCount } from "../../ui/src/processes/feedText";
import { AdminBriefs, BriefPage, Outcomes } from "../../ui/src/lazyPages";
import { briefResponseContext } from "../../src/shared/feedActivity";
import type { ProcessUi } from "../../ui/src/processes/types";
import { formatShortDate } from "../../ui/src/utils/dates";

/**
 * A vote's results page from before briefs (the retired civic.vote_results,
 * engine 2, C): its record is a brief now, at the same id, so its published
 * address keeps answering by sending the reader there.
 */
function VoteResultsRedirect() {
  const { id } = useParams();
  return <Navigate to={`/brief/${id}`} replace />;
}

const briefUi: ProcessUi = {
  type: "civic.brief",
  routes: [
    // Unified Briefs queue — the universal admin results surface.
    { path: "/admin/briefs", element: <AdminBriefs />, admin: true },
    { path: "/admin/briefs/:id", element: <AdminBriefs />, admin: true },
    // Public brief page — the permanent record of a completed process
    // (the /brief path is reclaimed from the old Slice 8.5 redirect).
    { path: "/outcomes", element: <Outcomes /> },
    { path: "/brief/:id", element: <BriefPage /> },
    // A vote's results from before briefs: now a brief at the same id.
    { path: "/vote-results/:id", element: <VoteResultsRedirect /> },
  ],
  feed: {
    // A vote's results published before briefs (the retired civic.vote_results'
    // card; its record is a brief now, read as one).
    "vote-results": {
      card: ({ id, data, getTitle }) => {
        const headline = typeof data.headline_result === "string" ? data.headline_result : "";
        return {
          title: getTitle(id) ?? "Vote results",
          summary:
            headline ||
            (hub.governing_body_short ? `Delivered to the ${hub.governing_body_name || hub.governing_body_short}.` : ""),
        };
      },
      meta: (id) =>
        getPublicBrief(id).then((b) => ({
          title: b.title,
          imageUrl: b.image_url ?? null,
          imageAlt: b.image_alt ?? null,
          totalVotes: b.participation_count ?? 0,
          commentsCount: b.comments?.length ?? 0,
        })),
      titleNeedsMeta: true,
      engagement: (meta) => {
        const n = meta.totalVotes ?? 0;
        const m = meta.commentsCount ?? 0;
        if (n === 0 && m === 0) return null;
        const parts: string[] = [];
        if (n > 0) parts.push(`${formatCount(n)} ${hub.noun(n)} voted`);
        if (m > 0) parts.push(`${formatCount(m)} ${m === 1 ? "comment" : "comments"}`);
        return parts.join(" · ");
      },
    },
    brief: {
      card: ({ id, data, getTitle }) => {
        // Rendered from the publish event alone (no metadata fetch): the
        // process title as the card title, the outcome headline as summary.
        const brief = (data.brief ?? {}) as { title?: string; headline?: string };
        return {
          title: brief.title ?? getTitle(id) ?? "Civic Brief",
          summary: brief.headline ?? "",
        };
      },
      // Brief cards render entirely from their event (title + headline,
      // or title + response excerpt), so no fetch is needed — and we
      // deliberately do NOT call getProcessState here (it would expose
      // the brief's admin read model). Resolve empty so the render gate
      // passes.
      meta: () => Promise.resolve({}),
      engagement: (meta) =>
        meta.lastEditedAt
          ? `Updated ${formatShortDate(meta.lastEditedAt)}`
          : null,
    },
    "brief-response": {
      card: ({ id, data, getTitle }) => {
        // Rendered from the response event alone: the brief's title as the
        // card title, the official as the byline, and the shared context
        // line ("Responding to the community's Civic Brief on this …") in
        // the metadata slot. NO excerpt of the response — a truncated quote
        // can misrepresent an official statement (Adam, 2026-08-28); the
        // card links to /brief/:id where every response (including any
        // collapsed under the 24h anchor) reads in full and in context.
        const brief = (data.brief ?? {}) as {
          title?: string;
          source_process_type?: string;
        };
        const response = (data.response ?? {}) as {
          official_title?: string;
          responder_name?: string;
        };
        const byline = [response.responder_name, response.official_title]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .join(", ");
        return {
          title: brief.title ?? getTitle(id) ?? "Civic Brief",
          summary: "",
          authorName: byline || null,
          engagement: briefResponseContext(brief.source_process_type),
        };
      },
      meta: () => Promise.resolve({}),
    },
  },
  settingsPanel: () => (
    <p className="form-hint">
      Who receives a brief is set under{" "}
      <Link to="/admin/settings/officials">Officials</Link> (brief recipients).
    </p>
  ),
};

export default briefUi;
