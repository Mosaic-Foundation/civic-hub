// civic.proposal: an idea residents float for discussion and support
// (manifest: src/modules/civic.proposals/manifest.ts).

import Propose from "../pages/Propose";
import ProposalDetail from "../pages/ProposalDetail";
import DraftPage from "../pages/draft/DraftPage";
import { proposalKind } from "../pages/draft/proposalKind";
import { ParticipationValues } from "../pages/settings/pluginFields";
import type { ProcessUi } from "./types";

export const proposalUi: ProcessUi = {
  type: "civic.proposal",
  routes: [
    { path: "/propose", element: <Propose /> },
    { path: "/propose/new", element: <DraftPage config={proposalKind} /> },
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
