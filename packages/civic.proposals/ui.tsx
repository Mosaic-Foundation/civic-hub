// civic.proposal: an idea residents float for discussion and support
// (manifest: packages/civic.proposals/manifest.ts). Its pages are its own
// (./ui/), built from the SDK's UI entry alone, and load when first opened.

import { lazy } from "react";
import { ParticipationValues, type ProcessUi } from "@civic-social/plugin-sdk/ui";

const Propose = lazy(() => import("./ui/Propose"));
const NewProposal = lazy(() => import("./ui/NewProposal"));
const ProposalDetail = lazy(() => import("./ui/ProposalDetail"));

const proposalUi: ProcessUi = {
  type: "civic.proposal",
  routes: [
    { path: "/propose", element: <Propose /> },
    { path: "/propose/new", element: <NewProposal /> },
    { path: "/proposal/:id", element: <ProposalDetail /> },
  ],
  feed: {
    proposal: {
      card: ({ id, data, getTitle, descSummary }) => {
        const prop = data.proposal as { title?: string } | undefined;
        return {
          title: prop?.title ?? getTitle(id) ?? "New proposal",
          summary: descSummary,
        };
      },
      // No fetch: resident proposals (prop_*) are not processes, so
      // /process/:id/state 404'd on every load — eight wasted
      // requests per feed (perf pass, 2026-08-28). The card renders
      // fully from the event payload (data.proposal.title).
      meta: () => Promise.resolve({}),
    },
    "proposal-closed": {
      card: ({ id, getTitle, descSummary }) => ({ title: getTitle(id) ?? "Proposal", summary: descSummary }),
      meta: () => Promise.resolve({}),
      titleNeedsMeta: true,
    },
  },
  settingsPanel: () => <ParticipationValues show="anonymity" />,
};

export default proposalUi;
