// civic.polis_deliberation: a structured group conversation
// (manifest: src/shared/polis_deliberation/manifest.ts). The conversation plugin.

import Deliberations from "../pages/Deliberations";
import DeliberationDetail from "../pages/DeliberationDetail";
import DraftPage from "../pages/draft/DraftPage";
import { conversationKind } from "../pages/draft/conversationKind";
import { getProcessState } from "../services/api";
import { UrlField } from "../pages/settings/pluginFields";
import type { FeedKindUi, ProcessUi } from "./types";

// Polis conversations expose their subject as `topic`/`framing` in
// the read model, not `title`/`description` — map them so the feed
// card keeps the original conversation topic instead of falling
// back to the literal "Conversation results".
const conversationMeta: FeedKindUi["meta"] = (id) =>
  getProcessState(id).then((state) => {
    const s = state as unknown as Record<string, unknown>;
    return {
      title: (s.title ?? s.topic) as string | undefined,
      description: (s.description ?? s.framing) as string | undefined,
    };
  });

export const conversationUi: ProcessUi = {
  type: "civic.polis_deliberation",
  routes: [
    { path: "/deliberations", element: <Deliberations /> },
    { path: "/deliberations/new", element: <DraftPage config={conversationKind} /> },
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
