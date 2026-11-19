// The Members plugin's UI module (ui/src/features.ts): the Members page and
// its section in the navigation (with its count), the count and faces on
// Home, the count in the right column's About card, a person's "Show me on
// the Members page", who hid themselves in Admin → Settings → People, and
// its panel on the Plugins page (the threshold).

import { lazy } from "react";
import type { FeatureUi } from "../../ui/src/features";
import MemberCount, { AboutMemberLine } from "./ui/MemberCount";
import AccountPanel from "./ui/AccountPanel";
import HiddenMembers from "./ui/HiddenMembers";
import { membersSettingsPanel } from "./ui/SettingsPanel";
import { getMemberSummary } from "./ui/api";
import { pageShownBy } from "./ui/visibility";

const MembersPage = lazy(() => import("./ui/Members"));

const membersUi: FeatureUi = {
  feature: "members",
  routes: [{ path: "/members", element: <MembersPage /> }],
  section: {
    shown: pageShownBy,
    // Read as "Members 7,925": the word already says what the number counts.
    count: async () => (await getMemberSummary()).count,
  },
  homeBlock: MemberCount,
  aboutLine: AboutMemberLine,
  accountPanel: AccountPanel,
  peopleSection: HiddenMembers,
  settingsPanel: membersSettingsPanel,
};

export default membersUi;
