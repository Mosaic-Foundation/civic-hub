// Written by `npm run plugins:sync` from config/plugins.json. Do not edit.
// Every configured package's UI module, in load order, for ui/src/processes/index.ts.

import type { ProcessUi } from "../../ui/src/processes/types";
import u0 from "../../packages/civic.vote/ui";
import u1 from "../../packages/civic.proposals/ui";
import u2 from "../../packages/civic.projects/ui";
import u3 from "../../packages/civic.vote_results/ui";
import u4 from "../../packages/civic.brief/ui";
import u5 from "../../packages/civic.announcement/ui";
import u6 from "../../packages/civic.meeting_summary/ui";
import u7 from "../../packages/civic.polis_deliberation/ui";
import u8 from "../../packages/civic.wordcloud/ui";
import u9 from "../../packages/civic.event/ui";

export const PACKAGE_UI: readonly ProcessUi[] = [u0, u1, u2, u3, u4, u5, u6, u7, u8, u9];
