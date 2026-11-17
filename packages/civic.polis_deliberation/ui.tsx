// civic.polis_deliberation: a structured group conversation
// (manifest: packages/civic.polis_deliberation/manifest.ts). Its pages are its
// own (./ui/), built from the SDK's UI entry alone, and load when first opened.

import { lazy } from "react";
import { apiRequest, UrlField, type FeedKindUi, type ProcessUi } from "@civic-social/plugin-sdk/ui";

const Deliberations = lazy(() => import("./ui/Deliberations"));
const NewConversation = lazy(() => import("./ui/NewConversation"));
const DeliberationDetail = lazy(() => import("./ui/DeliberationDetail"));

// Polis conversations expose their subject as `topic`/`framing` in
// the read model, not `title`/`description` — map them so the feed
// card keeps the original conversation topic instead of falling
// back to the literal "Conversation results".
const conversationMeta: FeedKindUi["meta"] = (id) =>
  apiRequest<Record<string, unknown>>("GET", `/process/${id}/state`).then((s) => {
    return {
      title: (s.title ?? s.topic) as string | undefined,
      description: (s.description ?? s.framing) as string | undefined,
    };
  });

const conversationUi: ProcessUi = {
  type: "civic.polis_deliberation",
  routes: [
    { path: "/deliberations", element: <Deliberations /> },
    { path: "/deliberations/new", element: <NewConversation /> },
    { path: "/deliberation/:id", element: <DeliberationDetail /> },
  ],
  feed: {
    conversation: {
      card: ({ id, data, getTitle, descSummary }) => {
        const proc = data.process as { title?: string } | undefined;
        return {
          title: proc?.title ?? getTitle(id) ?? "New conversation",
          summary: descSummary,
        };
      },
      meta: conversationMeta,
    },
    "conversation-results": {
      card: ({ id, getTitle, descSummary }) => ({ title: getTitle(id) ?? "Conversation results", summary: descSummary }),
      meta: conversationMeta,
      titleNeedsMeta: true,
    },
  },
  settingsPanel: (f) => (
    <UrlField
      f={f}
      k="plugin.conversation.polis_url"
      label="Conversation server"
      hint="The address of the Polis server this hub's conversations run on."
    />
  ),
};

export default conversationUi;
