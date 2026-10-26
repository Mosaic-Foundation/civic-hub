// civic.wordcloud's UI module: one-word answers gathered into a cloud
// (manifest: ./manifest.ts). Its pages are the hub's (ui/src/pages/), for now.

import { CreateWordCloud, WordCloud } from "../../ui/src/lazyPages";
import { getWordcloud } from "../../ui/src/services/api";
import { ProcessField } from "../../ui/src/pages/settings/pluginFields";
import { formatCount } from "../../ui/src/processes/feedText";
import type { ProcessUi } from "../../ui/src/processes/types";

const wordcloudUi: ProcessUi = {
  type: "civic.wordcloud",
  routes: [
    { path: "/wordcloud/new", element: <CreateWordCloud /> },
    { path: "/wordcloud/:id", element: <WordCloud /> },
  ],
  feed: {
    wordcloud: {
      card: ({ id, getTitle, descSummary }) => ({ title: getTitle(id) ?? "Word Cloud", summary: descSummary }),
      meta: (id) =>
        getWordcloud(id).then((wc) => ({
          title: wc.title,
          description: wc.description,
          totalVotes: wc.submission_count,
        })),
      titleNeedsMeta: true,
      engagement: (meta) => {
        const n = meta.totalVotes ?? 0;
        if (n === 0) return "Share what's on your mind — be the first to respond";
        const noun = n === 1 ? "response" : "responses";
        return `${formatCount(n)} ${noun} so far`;
      },
    },
  },
  settingsPanel: (f) => (
    <ProcessField
      f={f}
      k="plugin.wordcloud.onboarding_id"
      label="The hub's word cloud"
      hint="Shown in the strip at the top of every page, and where a new account lands after signing up. None hides the strip."
      create={{
        to: "/wordcloud/new",
        label: "Create a word cloud",
        none: "This hub has no word cloud yet, so the strip is hidden.",
      }}
    />
  ),
};

export default wordcloudUi;
