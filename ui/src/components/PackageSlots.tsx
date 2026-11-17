// Where the kernel draws what packages add to its own pages (kernel step 3,
// docs/kernel/SURFACE.md "Event: couplings that go"). Each process type's UI
// module may say what it contributes (`contributes`, processes/types.ts); the
// kernel draws those of the packages whose plugin is on, in the manifests'
// order, and names none of them.

import { Fragment } from "react";
import { useHub } from "../config/hub";
import { PROCESS_UI } from "../processes";
import { pluginOfType } from "../processes/display";
import type { AdminQueueTab, PackageContributions, ProcessUi } from "../processes/types";

type Hub = ReturnType<typeof useHub>;

/** The contributions of every package whose plugin is on (all of them for a type with no plugin). */
function contributionsOn(hub: Hub): Array<{ type: string; contributes: PackageContributions }> {
  return PROCESS_UI.flatMap((ui: ProcessUi) => {
    if (!ui.contributes) return [];
    const plugin = pluginOfType(ui.type);
    if (plugin && !hub.plugins.enabled(plugin)) return [];
    return [{ type: ui.type, contributes: ui.contributes }];
  });
}

/** What packages add at the top of a process page, under its header. */
export function ProcessPageTop({ processId }: { processId: string }) {
  const hub = useHub();
  return (
    <>
      {contributionsOn(hub).map(({ type, contributes: { processTop: Top } }) =>
        Top ? <Top key={type} processId={processId} /> : null,
      )}
    </>
  );
}

/** What packages add to the strip across the top of the hub's public pages. */
export function WelcomeStripSlot() {
  const hub = useHub();
  return (
    <>
      {contributionsOn(hub).map(({ type, contributes: { welcomeStrip: Strip } }) =>
        Strip ? (
          <Fragment key={type}>
            <Strip />
          </Fragment>
        ) : null,
      )}
    </>
  );
}

/** The packages' review queues the admin rail shows, in the manifests' order. */
export function adminQueueTabs(hub: Hub): AdminQueueTab[] {
  return contributionsOn(hub).flatMap(({ contributes }) => (contributes.adminQueue ? [contributes.adminQueue] : []));
}
