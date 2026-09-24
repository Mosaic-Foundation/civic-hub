// civic.news_sync — connector registry
//
// Supporting a new publishing platform is a new module in this folder plus one
// entry here. The id is what a hub stores in `plugin.news_sync.connector`, so
// an id, once shipped, is never renamed.

import type { NewsConnector } from "../models.js";
import { wixCmsNewsConnector } from "./wixCms.js";

export const NEWS_CONNECTORS: Readonly<Record<string, NewsConnector>> = {
  [wixCmsNewsConnector.id]: wixCmsNewsConnector,
};

/** The connector registered under `id`, or null. */
export function newsConnectorFor(id: string): NewsConnector | null {
  return Object.prototype.hasOwnProperty.call(NEWS_CONNECTORS, id)
    ? NEWS_CONNECTORS[id]
    : null;
}
