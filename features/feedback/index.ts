// Feedback: a form for residents to report problems or suggest changes, and
// Admin → Feedback to read them (a kernel module until kernel step 4,
// 2026-11-19: "if it can be a plugin, it is one"; Adam asked for an off
// switch). A Bug or an Idea also goes to Civic.Social, through the kernel's
// provider inbox. A hub feature built as a plugin package is
// (src/plugins/feature.ts): one folder, the SDK and src/shared/ only, its own
// table, its switch plugin.feedback.enabled. No other plugin knows of it.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { FEEDBACK_MANIFEST } from "./manifest.js";
import { feedbackStore } from "./store.js";
import { adminFeedbackRoutes, feedbackRoutes } from "./routes.js";

const feedback: FeaturePackage = {
  name: "@civic-social/feature-feedback",
  version: "0.1.0",
  displayName: "Feedback",
  manifest: FEEDBACK_MANIFEST,
  server(host) {
    const store = feedbackStore(host);
    return {
      routes: [{ path: "/feedback", router: feedbackRoutes(store) }],
      adminRoutes: [{ path: "/feedback", router: adminFeedbackRoutes(store) }],
      // Admin → Feedback's count, and its line in the admin digest.
      queues: [
        {
          name: "feedback",
          noun: { one: "feedback message", many: "feedback messages" },
          path: "/admin/feedback",
          count: (since, until) => store.countSince(since, until),
        },
      ],
    };
  },
};

export default feedback;
