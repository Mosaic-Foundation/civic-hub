// The Writing assistant: an AI chat beside a draft, with suggestion cards the
// person applies, and "Get suggestions" against the type's best practices
// (kernel step 3; it was src/modules/civic.assistant). A hub feature built as a
// plugin package is (src/plugins/feature.ts), its switch plugin.assistant.enabled.
// What a type's assistant knows comes from its handler
// (ProcessHandler.getAssistantConfig). The Code of Conduct check at Submit is
// the kernel's, and runs with the assistant off.

import type { FeaturePackage } from "../../src/sdk/index.js";
import { ASSISTANT_MANIFEST } from "./manifest.js";
import { assistantRouter } from "./routes.js";

const assistant: FeaturePackage = {
  name: "@civic-social/feature-assistant",
  version: "0.1.0",
  displayName: "Writing assistant",
  manifest: ASSISTANT_MANIFEST,
  server() {
    return { routes: [{ path: "/assistant", router: assistantRouter() }] };
  },
};

export default assistant;
