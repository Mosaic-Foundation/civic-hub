// Whether this reader gets the Members page and its section now: the
// plugin's switch on, and either past its threshold (or shown anyway, as the
// server says in the space's config) or the reader an admin.

import { getLoadedHubConfig } from "../../../ui/src/config/hubConfig";
import { pluginEnabled } from "../../../ui/src/config/plugins";

/** The server's word in the space's config (features/members/index.ts's hubConfig). */
export function pageShownBy(config: Readonly<Record<string, unknown>> | undefined, admin: boolean): boolean {
  return admin || config?.page_shown !== false;
}

export function membersPageShown(admin: boolean): boolean {
  if (!pluginEnabled("members")) return false;
  return pageShownBy(getLoadedHubConfig()?.features?.members, admin);
}
