// civic.wordcloud: one-word answers gathered into a cloud
// (manifest: src/modules/civic.wordcloud/manifest.ts).

import WordCloud from "../pages/WordCloud";
import CreateWordCloud from "../pages/CreateWordCloud";
import { getWordcloud } from "../services/api";
import { ProcessField } from "../pages/settings/pluginFields";
import { formatCount } from "./feedText";
import type { ProcessUi } from "./types";

export const wordcloudUi: ProcessUi = {
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
