// What the packages whose plugin is on contribute to the kernel's pages, as
// data: the slots' components are in PackageSlots.tsx (apart, so fast refresh
// keeps working there).

import type { useHub } from "../config/hub";
import { PROCESS_UI } from "../processes";
import { pluginOfType } from "../processes/display";
import { safeReturnPath } from "../config/pluginRules";
import type { AdminQueueTab, PackageContributions, ProcessUi } from "../processes/types";

type Hub = ReturnType<typeof useHub>;

/** The contributions of every package whose plugin is on (all of them for a type with no plugin). */
export function contributionsOn(hub: Hub): Array<{ type: string; contributes: PackageContributions }> {
  return PROCESS_UI.flatMap((ui: ProcessUi) => {
    if (!ui.contributes) return [];
    const plugin = pluginOfType(ui.type);
    if (plugin && !hub.plugins.enabled(plugin)) return [];
    return [{ type: ui.type, contributes: ui.contributes }];
  });
}

/** The packages' review queues the admin rail shows, in the manifests' order. */
export function adminQueueTabs(hub: Hub): AdminQueueTab[] {
  return contributionsOn(hub).flatMap(({ contributes }) => (contributes.adminQueue ? [contributes.adminQueue] : []));
}

/** Where a new member goes right after signing up: the first package's stop, or null. */
export function afterSignUpStop(hub: Hub, here: string): string | null {
  // Only a local path is handed on, so a package's stop cannot become an open redirect.
  const back = safeReturnPath(here);
  for (const { contributes } of contributionsOn(hub)) {
    const to = contributes.afterSignUp?.(back);
    if (to) return to;
  }
  return null;
}
