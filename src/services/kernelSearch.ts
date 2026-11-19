// The kernel's search (kernel step 4, 2026-11-19): the index every plugin's
// items go into (the search_processes functions over each process's
// search_doc), and one query over it, hub-scoped, leaving out types whose
// plugin is off. The kernel keeps it because more than one plugin reads it
// (the Search page, a link's typeahead); the Search page and the box in the
// top bar are the Search plugin's (features/search). A plugin reads it
// through the SDK (`search.query(query)`).

import { executeSearch, type SearchQuery, type SearchResultPage } from "../modules/civic.search/index.js";
import { countSearchRpc, executeSearchRpc } from "./searchExecutor.js";
import { processDetailPath } from "../processes/registry.js";

export const search = {
  /** One page of hits for a query, with the total; an empty `q` answers empty without a read. */
  query(query: SearchQuery): Promise<SearchResultPage> {
    return executeSearch(query, { execute: executeSearchRpc, count: countSearchRpc, hrefFor: processDetailPath });
  },
};
