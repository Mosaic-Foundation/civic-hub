// Every process type's UI module, in the manifests' order
// (src/shared/processManifests.ts). App mounts their routes, the feed renders
// their kinds, the Plugins page shows their panels and the link picker reads
// their default relation. A plugin package's UI module is its ui.tsx, listed
// by `npm run plugins:sync` in config/plugins/ui.ts (ADR-014); the types not
// yet moved into packages have theirs here.

import type { ReactNode } from "react";
import type { ActivityKind } from "../../../src/shared/feedActivity";
import { MANIFEST_LIST } from "../../../src/shared/processManifests";
import type { FormApi } from "../pages/settings/pluginFields";
import type { FeedKindUi, ProcessUi } from "./types";
import { voteResultsUi } from "./voteResults";
import { briefUi } from "./brief";
import { announcementUi } from "./announcement";
import { meetingSummaryUi } from "./meetingSummary";
import { conversationUi } from "./conversation";
import { PACKAGE_UI } from "../../../config/plugins/ui";

const MODULES: readonly ProcessUi[] = [
  voteResultsUi,
  briefUi,
  announcementUi,
  meetingSummaryUi,
  conversationUi,
  ...PACKAGE_UI,
];

/** The modules in MANIFEST_LIST order; a manifest without a module, or the reverse, is a bug caught at load. */
export const PROCESS_UI: readonly ProcessUi[] = MANIFEST_LIST.map((m) => {
  const ui = MODULES.find((u) => u.type === m.descriptor.type);
  if (!ui) throw new Error(`process type ${m.descriptor.type} has a manifest but no UI module (ui/src/processes/index.ts)`);
  return ui;
});

for (const ui of MODULES) {
  if (!PROCESS_UI.includes(ui)) throw new Error(`UI module for ${ui.type} has no manifest (src/shared/processManifests.ts)`);
}

const BY_TYPE: ReadonlyMap<string, ProcessUi> = new Map(PROCESS_UI.map((u) => [u.type, u]));

/** A type's UI module, or undefined for a type this build has no UI for. */
export function processUiOf(type: string | undefined): ProcessUi | undefined {
  return type ? BY_TYPE.get(type) : undefined;
}

const FEED_KINDS: ReadonlyMap<ActivityKind, FeedKindUi> = (() => {
  const map = new Map<ActivityKind, FeedKindUi>();
  for (const ui of PROCESS_UI) {
    for (const [kind, kindUi] of Object.entries(ui.feed ?? {}) as Array<[ActivityKind, FeedKindUi]>) {
      if (map.has(kind)) throw new Error(`feed kind "${kind}" is claimed by two process UI modules (second: ${ui.type})`);
      map.set(kind, kindUi);
    }
  }
  return map;
})();

/** How a feed kind renders, or undefined for a kind no module claims. */
export function feedKindUi(kind: ActivityKind): FeedKindUi | undefined {
  return FEED_KINDS.get(kind);
}

/** A process plugin's panel on the Plugins page: its module's settingsPanel, or null. */
export function processSettingsPanel(plugin: string, f: FormApi): ReactNode | null {
  const owner = MANIFEST_LIST.find((m) => m.descriptor.plugin === plugin && m.pluginSection);
  return (owner && processUiOf(owner.descriptor.type)?.settingsPanel?.(f)) ?? null;
}
