// civic.news's UI module: a post News Sync copied in from another site
// (manifest: ./manifest.ts). Its card opens the original; its page is its own
// (./ui/), built from the SDK's UI entry alone, and loads when first opened.

import { lazy } from "react";
import type { FeedKindUi, ProcessUi } from "@civic-social/plugin-sdk/ui";
import { getNewsItem } from "./ui/api";

const NewsItemPage = lazy(() => import("./ui/NewsItem"));

const newsKind: FeedKindUi = {
  card: ({ id, data, getTitle, descSummary }) => {
    // A News item's own payload, or (copied in before the split) the announcement's.
    const own = (data.news ?? data.announcement) as { title?: string } | undefined;
    return { title: own?.title ?? getTitle(id) ?? "News", summary: descSummary };
  },
  meta: (id) => getNewsItem(id).then((n) => ({ title: n.title, description: n.body })),
};

const newsUi: ProcessUi = {
  type: "civic.news",
  routes: [{ path: "/news/:id", element: <NewsItemPage /> }],
  feed: { news: newsKind },
};

export default newsUi;
