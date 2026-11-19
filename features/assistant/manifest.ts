// The Writing assistant's manifest (ADR-016; src/processes/manifest.ts's
// FeatureManifest). Plain data. It owns no table and runs no job: a draft's
// conversation is kept on the draft, by the type's own draft store.

import { defineFeatureManifest } from "../../src/processes/manifest.js";

export const ASSISTANT_MANIFEST = defineFeatureManifest({
  feature: "assistant",
  tables: [],
  requiredSchema: [],
  jobs: [],
  pluginSection: {
    order: 100,
    name: "Writing assistant",
    what: "AI help while drafting a vote, proposal, project or conversation.",
    fields: [],
    words: ["ai", "artificial intelligence", "writing help", "llm", "claude", "chatbot"],
  },
});
