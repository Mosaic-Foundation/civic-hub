// civic.news's UI module: a post News Sync copied in from another site
// (manifest: ./manifest.ts). Its card opens the original; its page is its own
// (./ui/), built from the SDK's UI entry alone, and loads when first opened.
// Its filter pill above the feed, its card's pill and "From" line, and its
// panel on the Plugins page are its own too (kernel step 3, Nov 19).

import { lazy } from "react";
import {
  ChoiceField,
  TextField,
  UrlField,
  spaceNow,
  useSpace,
  type FeedKindUi,
  type FormApi,
  type ProcessUi,
} from "@civic-social/plugin-sdk/ui";
import { getNewsItem } from "./ui/api";
import { DEFAULT_NEWS_PILL, newsFromLabel, newsFromNow } from "./models";

const NewsItemPage = lazy(() => import("./ui/NewsItem"));

const newsKind: FeedKindUi = {
  card: ({ activity, id, data, getTitle, descSummary }) => {
    // A News item's own payload, or (copied in before the split) the announcement's.
    const own = (data.news ?? data.announcement) as { title?: string } | undefined;
    // The hub's labels as set now name every item, including ones copied in
    // before a change (one source per hub); the item's own stand in.
    const space = spaceNow();
    return {
      title: own?.title ?? getTitle(id) ?? "News",
      summary: descSummary,
      pill: space.setting("plugin.news_sync.pill_label").trim() || activity.pill,
      authorName: activity.from ? `From ${newsFromNow(space.setting("plugin.news_sync.from_label"), activity.from)}` : null,
    };
  },
  meta: (id) => getNewsItem(id).then((n) => ({ title: n.title, description: n.body })),
};

const NEWS_CONNECTOR_LABELS: Record<string, string> = {
  "wix-cms": "Wix blog feed",
};

/**
 * News Sync's panel: where the posts come from, and how they read on the feed.
 * Its posts are News items of their own, so it needs nothing else switched on
 * (2026-11-18).
 */
function NewsSyncPanel({ f }: { f: FormApi }) {
  const space = useSpace();
  return (
    <>
      <ChoiceField
        f={f}
        k="plugin.news_sync.connector"
        label="Kind of feed"
        labels={NEWS_CONNECTOR_LABELS}
        emptyLabel="Not set up"
      />
      <UrlField f={f} k="plugin.news_sync.source_url" label="Feed address" hint="Both must be set for news sync to run." />
      <TextField
        f={f}
        k="plugin.news_sync.from_label"
        label="From label"
        placeholder={newsFromLabel(null, space.placeName)}
        hint={'Shown on each synced post as "From …", so residents know where it came from. Applies to every synced post, including ones copied in earlier. Left empty, it reads as shown here.'}
      />
      <TextField
        f={f}
        k="plugin.news_sync.pill_label"
        label="Pill label"
        placeholder={DEFAULT_NEWS_PILL}
        hint={'The tag on each synced post in the feed, and the name of its filter: "County news", "Government announcement". Applies to every synced post, including ones copied in earlier. Left empty, it reads "News". An admin can pin any post from its page.'}
      />
    </>
  );
}

const newsUi: ProcessUi = {
  type: "civic.news",
  routes: [{ path: "/news/:id", element: <NewsItemPage /> }],
  feed: { news: newsKind },
  // Posts copied in from another site (2026-11-16), under the hub's own word
  // for them (plugin.news_sync.pill_label, 2026-11-18).
  feedFilter: {
    surface: "news",
    label: (space) => space.setting("plugin.news_sync.pill_label").trim() || DEFAULT_NEWS_PILL,
    pillClass: "news",
  },
  settingsPanel: (f) => <NewsSyncPanel f={f} />,
};

export default newsUi;
