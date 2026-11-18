// News Sync's feed reading: connectors, discovery, config and paraphrase (../job.ts uses it)

export type {
  DiscoverDeps,
  FetchTextFn,
  NewsConnector,
  NewsEntry,
  NewsSyncConfig,
} from "./models.js";

export {
  parseRssFeed,
  parseEventDate,
  parseRfc822ToIso,
  isFutureOrUndated,
  wixPostUrlPattern,
  wixCmsNewsConnector,
} from "./connectors/wixCms.js";

export { NEWS_CONNECTORS, newsConnectorFor } from "./connectors/index.js";

export { discoverNewsEntries } from "./pipeline.js";

export { resolveNewsSyncConfig, type NewsSyncResolution } from "./config.js";

export {
  buildParaphrasePrompt,
  cleanParaphrase,
  paraphraseTitle,
  type ParaphraseDeps,
  type ParaphraseInput,
  type ParaphrasePlace,
} from "./paraphrase.js";
