// civic.wordcloud's UI module: one-word answers gathered into a cloud
// (manifest: ./manifest.ts). Its pages are its own (./ui/), built from the SDK's
// UI entry alone, and load when first opened.

import { lazy } from "react";
import { ProcessField, formatCount, spaceNow, type ProcessUi } from "@civic-social/plugin-sdk/ui";
import { getWordcloud } from "./ui/api";
import WordcloudTeaser from "./ui/WordcloudTeaser";
import { onboardingStop } from "./ui/onboarding";

const WordCloud = lazy(() => import("./ui/WordCloud"));
const CreateWordCloud = lazy(() => import("./ui/CreateWordCloud"));

const wordcloudUi: ProcessUi = {
  type: "civic.wordcloud",
  // The hub's word cloud in the strip across the top of its pages, and where
  // a new member lands after signing up.
  contributes: {
    welcomeStrip: WordcloudTeaser,
    afterSignUp: (back) => onboardingStop(spaceNow().setting("plugin.wordcloud.onboarding_id"), back),
  },
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
