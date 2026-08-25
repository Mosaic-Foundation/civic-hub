// civic.search — public surface.

export type {
  SearchCountFn,
  SearchExecuteFn,
  SearchFilters,
  SearchHit,
  SearchHitRow,
  SearchQuery,
  SearchResultPage,
  SearchSort,
  SearchTypeKey,
} from "./models.js";

export {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_OFFSET_MAX,
} from "./models.js";

export { executeSearch, formatHit, validateQuery } from "./service.js";
export type { HrefResolver, SearchDeps } from "./service.js";
