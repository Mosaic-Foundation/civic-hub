// The Feedback plugin's manifest (src/processes/manifest.ts's FeatureManifest).
// Plain data: the host reads its table and its Plugins entry without loading
// its code.

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const FEEDBACK_MANIFEST = defineFeatureManifest({
  feature: "feedback",
  tables: [
    {
      name: "feedback_submissions",
      rows: "export",
      key: ["id"],
      holds: "what residents sent through the Feedback form, and whether Civic.Social has a copy",
    },
  ],
  requiredSchema: [
    {
      table: "feedback_submissions",
      columns: [
        "hub_id",
        "id",
        "created_at",
        "category",
        "message",
        "name",
        "email",
        "user_id",
        "user_agent",
        "screenshot_url",
        "page_path",
        "software_version",
        "contact_ok",
        "mosaic_item_id",
        "mosaic_stream",
        "mosaic_status",
        "mosaic_sent_at",
        "mosaic_sent_by",
      ],
      owner: "features/feedback",
    },
  ],
  jobs: [],
  // The address the Feedback page shows (2026-10-08, Adam).
  pluginSection: {
    order: 120,
    name: "Feedback",
    what: "A form for residents to report problems or suggest changes.",
    fields: [{ key: "plugin.feedback.contact_email", kind: "email" }],
    words: ["feedback", "contact", "bug reports", "report a problem", "suggestions"],
  },
});
