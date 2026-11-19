// The Members plugin's manifest (src/processes/manifest.ts's FeatureManifest).
// Plain data. It owns no table: membership is the kernel's (users, SDK
// `membership`).

import { defineFeatureManifest } from "../../src/processes/manifest.js";
import { MIN_COUNT_KEY, PAGE_BEFORE_THRESHOLD_KEY } from "./rules.js";

export const MEMBERS_MANIFEST = defineFeatureManifest({
  feature: "members",
  tables: [],
  requiredSchema: [],
  jobs: [],
  pluginSection: {
    order: 150,
    name: "Members",
    what: "The member count and faces on the home page, and the Members page. Share this hub stays either way.",
    fields: [
      { key: MIN_COUNT_KEY, kind: "number", min: 0, max: 100000 },
      { key: PAGE_BEFORE_THRESHOLD_KEY, kind: "boolean" },
    ],
    words: ["members", "member count", "faces", "avatars", "directory", "residents list"],
  },
  // After Outcomes by default.
  section: { id: "members", label: "Members", short: "Members", path: "/members", icon: "members", order: 60 },
  // The count, the faces and the page wait for 10 members on a new space; a
  // space made before the Members plugin reads unset as 0 (Adam, 2026-10-14).
  newSpaceSettings: { [MIN_COUNT_KEY]: "10" },
});
