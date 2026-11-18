// What the hub's news sync job (src/jobs/newsSync.ts) uses of this package,
// loaded on first use: the published event, and the state's names.

export { emitNewsPublished } from "./events.js";
export { newsFrom, newsPill } from "./state.js";
export type { NewsProcessState, NewsSource } from "./models.js";
export { DEFAULT_NEWS_PILL } from "./models.js";
