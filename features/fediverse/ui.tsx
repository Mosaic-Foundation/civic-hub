// The Fediverse feature's UI module (ui/src/features.ts): its panel on the
// Plugins page (the handle, follower and post counts, how often to post,
// hashtags, blocked servers), "Follow on Mastodon" on the About page, a
// roundup's page, and the Fediverse card in Admin → Activity. The Share on
// Mastodon button lives with the other share buttons
// (ui/src/components/MastodonShare.tsx).

import { lazy } from "react";
import type { FeatureUi } from "../../ui/src/features";
import { ChoiceField, TextAreaField, TextField } from "../../ui/src/pages/settings/fields";
import FediverseStatus from "./ui/FediverseStatus";
import AboutFollow from "./ui/AboutFollow";
import ActivityFollowers from "./ui/ActivityFollowers";

const RoundupPage = lazy(() => import("./ui/RoundupPage"));

const POST_MODE_LABELS: Record<string, string> = {
  each: "Each item, as it opens or is decided",
  daily: "A daily roundup, on days with something new",
  weekly: "A weekly roundup, on Mondays",
};

const fediverseUi: FeatureUi = {
  feature: "fediverse",
  routes: [{ path: "/fediverse/roundups/:id", element: <RoundupPage /> }],
  settingsPanel: (f) => (
    <>
      <FediverseStatus on={f.value("plugin.fediverse.enabled") === "true"} />
      <ChoiceField
        f={f}
        k="plugin.fediverse.post_mode"
        label="How often to post"
        labels={POST_MODE_LABELS}
        hint="Posts name the item and link to it; never who started it or who took part. A roundup lists the first five and links to a page with all of them."
      />
      <TextField
        f={f}
        k="plugin.fediverse.hashtags"
        label="Extra hashtags"
        placeholder="FloydVA, FloydCounty"
        hint="Added to every post, besides #CivicHub and one from the hub's name. Separate them with commas."
      />
      <TextAreaField
        f={f}
        k="plugin.fediverse.blocked_servers"
        label="Blocked servers"
        placeholder="spam.example"
        rows={3}
        hint="One per line. Accounts on these servers can't follow, and nothing is sent to them. A domain blocks every server under it."
      />
    </>
  ),
  aboutBlock: AboutFollow,
  activitySection: ActivityFollowers,
};

export default fediverseUi;
