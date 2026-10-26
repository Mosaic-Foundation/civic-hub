// What the hub hands each package when it loads it (ADR-014): its database,
// limited to its granted tables, and its granted adapters. A reach past the
// grant is refused and reported (src/plugins/grant.ts).

import { forHub, type TableName } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { adapters } from "../adapters/index.js";
import { aiComplete, aiConfigured, aiDefaultModel } from "../adapters/ai.js";
import { sendEmail as sendMessage } from "../utils/email.js";
import { sendEmail as deliverEmail } from "../services/mailer.js";
import { notifyCronOutcome } from "../services/cronAlerts.js";
import { fetchHtml, fetchJson, fetchPdf, fetchXml } from "../utils/http.js";
import { getAdminEmailsSync } from "../services/hubSettings.js";
import type { GrantableAdapter, PluginCapabilities } from "../shared/pluginGrant.js";
import type { GrantedDb, PluginAdapters, PluginHost } from "./package.js";
import { refuseReach } from "./grant.js";

/** The hub in scope's database, refusing every table `tables` does not list. */
export function grantedDb(packageName: string, tables: readonly string[]): GrantedDb {
  return {
    from(table) {
      if (!tables.includes(table)) refuseReach(packageName, "table", table);
      return forHub(currentHubId()).from(table as TableName);
    },
  };
}

const ADAPTER_FACADES: { [K in GrantableAdapter]: () => PluginAdapters[K] } = {
  ai: () => ({ complete: aiComplete, configured: aiConfigured, defaultModel: aiDefaultModel }),
  mail: () => ({ send: sendMessage, deliver: deliverEmail, adminAddresses: getAdminEmailsSync, notifyJobOutcome: notifyCronOutcome }),
  web: () => ({ fetchHtml, fetchJson, fetchPdf, fetchXml }),
  // Read when asked, so a test or the hosting layer installing an adapter later is seen.
  video: () => adapters().video,
  deliberation: () => adapters().deliberation,
  objectStore: () => adapters().objectStore,
};

/** The host a package gets: its own grant decides what it can reach. */
export function createHost(packageName: string, caps: PluginCapabilities): PluginHost {
  return {
    packageName,
    db: () => grantedDb(packageName, caps.state.tables),
    adapter(name) {
      if (!caps.adapters.includes(name)) refuseReach(packageName, "adapter", name);
      return ADAPTER_FACADES[name]();
    },
  };
}
