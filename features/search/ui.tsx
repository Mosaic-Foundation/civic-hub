// The Search plugin's UI module (ui/src/features.ts): the Search page and the
// search box in the top bar and the menu drawer.

import { lazy } from "react";
import type { FeatureUi } from "../../ui/src/features";
import SearchBar from "./ui/SearchBar";

const SearchPage = lazy(() => import("./ui/Search"));

const searchUi: FeatureUi = {
  feature: "search",
  routes: [{ path: "/search", element: <SearchPage /> }],
  navTool: SearchBar,
};

export default searchUi;
