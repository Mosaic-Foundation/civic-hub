// civic.brief: the published record of what residents decided, sent to
// officials (manifest: ./manifest.ts).

import { Link } from "react-router-dom";
import { AdminBriefs, BriefPage, Outcomes } from "../../ui/src/lazyPages";
import { briefResponseContext } from "../../src/shared/feedActivity";
import type { ProcessUi } from "../../ui/src/processes/types";
import { formatShortDate } from "../../ui/src/utils/dates";

const briefUi: ProcessUi = {
  type: "civic.brief",
  routes: [
    // Unified Briefs queue — the universal admin results surface.
    { path: "/admin/briefs", element: <AdminBriefs />, admin: true },
    { path: "/admin/briefs/:id", element: <AdminBriefs />, admin: true },
    // Public brief page — the permanent record of a completed process
    // (the /brief path is reclaimed from the old Slice 8.5 redirect;
    // existing published vote-results stay at /vote-results/:id).
    { path: "/outcomes", element: <Outcomes /> },
    { path: "/brief/:id", element: <BriefPage /> },
  ],
  feed: {
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
