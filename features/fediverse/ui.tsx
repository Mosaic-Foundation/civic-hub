// The Fediverse feature's UI module (ui/src/features.ts): its panel on the
// Plugins page (the handle and follower count) and "Follow on Mastodon" on
// the About page. The Share on Mastodon button lives with the other share
// buttons (ui/src/components/MastodonShare.tsx).

import type { FeatureUi } from "../../ui/src/features";
import FediverseStatus from "./ui/FediverseStatus";
import AboutFollow from "./ui/AboutFollow";

const fediverseUi: FeatureUi = {
  feature: "fediverse",
  routes: [],
  settingsPanel: (f) => <FediverseStatus on={f.value("plugin.fediverse.enabled") === "true"} />,
  aboutBlock: AboutFollow,
};

export default fediverseUi;
