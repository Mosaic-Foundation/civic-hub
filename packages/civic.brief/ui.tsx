// civic.brief: the published record of what residents decided, sent to
// officials (manifest: ./manifest.ts). Its pages are its own (./ui/), built
// from the SDK's UI entry alone, and load when first opened.

import { lazy } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  briefResponseContext,
  formatCount,
  formatShortDate,
  spaceNow,
  type ProcessUi,
} from "@civic-social/plugin-sdk/ui";
import { getPublicBrief } from "./ui/api";
import { BriefPointer } from "./ui/BriefPointer";

const AdminBriefs = lazy(() => import("./ui/AdminBriefs"));
const Outcomes = lazy(() => import("./ui/Outcomes"));
const BriefPage = lazy(() => import("./ui/Brief"));

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
  // What Briefs adds to the kernel's pages: the pointer from a finished
  // process to its brief, and its review queue in the admin rail.
  contributes: {
    processTop: BriefPointer,
    adminQueue: { queue: "briefs", label: "Briefs", icon: "outcome", path: "/admin/briefs" },
  },
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
        const hub = spaceNow();
        return {
          title: getTitle(id) ?? "Vote results",
          summary:
            headline ||
            (hub.governingBodyShort ? `Delivered to the ${hub.governingBodyName || hub.governingBodyShort}.` : ""),
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
        if (n > 0) parts.push(`${formatCount(n)} ${spaceNow().participantNoun(n)} voted`);
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
