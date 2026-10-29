// The Events plugin package: the hub's calendar. What the hub loads: its
// name and version, its manifest, and server(host), called once.

import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import routes from "./routes.js";
import { eventDraftKind } from "./draftKind.js";
import { createEventStore, eventStore } from "./store.js";

const eventsPackage: PluginPackage = {
  name: "@civic-social/plugin-events",
  version: "0.3.2",
  displayName: "Events",
  manifest,
  server(host) {
    eventStore.bind(createEventStore(host.db));
    return {
      handler,
      drafts: { kind: eventDraftKind },
      routes: [{ path: "/calendar", router: routes }],
    };
  },
};

export default eventsPackage;
