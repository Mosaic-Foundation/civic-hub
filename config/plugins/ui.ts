// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's UI module, in load order, for ui/src/processes/index.ts.

import type { ProcessUi } from "../../ui/src/processes/types";
import u0 from "../../packages/civic.vote/ui";
import u1 from "../../packages/civic.wordcloud/ui";

export const PACKAGE_UI: readonly ProcessUi[] = [u0, u1];
