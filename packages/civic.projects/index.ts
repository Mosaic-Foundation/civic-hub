// The project plugin package (docs/PLUGIN-PACKAGE.md): its manifest, and what
// the hub runs when it loads it.

import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { projectDraftKind } from "./draftKind.js";
import { projectsStore } from "./store.js";
import { createProjectsStore } from "./storeImpl.js";

const projectPackage: PluginPackage = {
  name: "@civic-social/plugin-project",
  version: "0.1.1",
  displayName: "Projects",
  manifest,
  server(host) {
    projectsStore.bind(createProjectsStore(host.db));
    return {
      handler,
      drafts: { kind: projectDraftKind },
      routes: [{ path: "/projects", router: routes }],
    };
  },
};

export default projectPackage;
