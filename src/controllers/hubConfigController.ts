// GET /hub-config (served as /api/hub-config) — the public face of a hub's
// configuration, for the UI to read at boot instead of baking it into the
// bundle at build time.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Contracts / 2. hub_settings" for the
// key names and the public subset, and "4. Request flow" item 5 for the
// response shape.
//
// WHAT MAY APPEAR HERE. Only keys on the build plan's public list, which is a
// list of KEYS rather than of namespaces — so adding a setting can never make
// something public by accident. The beta allowlist, the people.* roster and
// every email.* address are admin-only and never appear.
//
// The values come from hub_settings rows, resolving through the alias map and
// then the env fallbacks, so an unseeded deployment answers exactly as it did
// before any of this existed.
//
// DOCUMENTS ARE NOT HERE. The legal pages and the About text are tens of
// kilobytes and almost no request renders one, so they are served separately
// by GET /hub-config/documents rather than loaded on every boot.

import { NotFoundError } from "../errors/index.js";
import { route } from "../http/route.js";
import type { Request } from "express";
import { pluginSetupFor } from "../services/pluginSetup.js";
import type { PluginSetupStatus } from "../shared/pluginSetup.js";
import { getPublicSettings, hubModeFor } from "../services/hubSettings.js";
import { hubDocumentsWithNotes } from "../services/hubDocuments.js";
import type { Hub, HubMode } from "../models/hub.js";
import { hubContentFlags } from "../services/sampleContent.js";
import { processTypeDisplays, type ProcessTypeDisplay } from "../processes/registry.js";
import { featureHubConfig } from "../plugins/features.js";
import { effectiveHubTimeZone, type HubTimeZone } from "../shared/hubTimeZone.js";
import { KEYS } from "../models/hubSettings.js";
import { ensureCensusDistrictsBriefly } from "../services/districtLookup.js";
import { adapters } from "../adapters/index.js";

/** The hub fields the contract makes public. */
interface PublicHub {
  id: string;
  name: string;
  hostname: string;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  space_did: string;
  /**
   * demo | beta | live. Public because the client renders it: the beta banner
   * and the demo messaging are both driven by it. Knowing a hub is a demo
   * discloses nothing — a demo hub advertises itself.
   */
  mode: HubMode;
}

export interface HubConfigResponse {
  hub: PublicHub;
  settings: Record<string, string>;
  /**
   * Plugins switched on that still need setup, by id (added 2026-10-07):
   * what is missing, and whether the public site shows them anyway. Absent
   * means ready. The rule: src/shared/pluginSetup.ts.
   */
  plugin_setup: Record<string, PluginSetupStatus>;
  /**
   * What the hub holds (added 2026-10-07): any sample content left, and a
   * Welcome page of its own. The beta bar and the /welcome links read them.
   * `sample_items` counts visitors' demo items too: the feed reads /events,
   * which never carries sample content, only when there are none.
   */
  content: { samples: boolean; welcome: boolean; sample_items: boolean };
  /**
   * Every registered process type as residents read it (navigation slice,
   * 2026-10-14): the feed pill's label, the icon, and the section it has in
   * the hub's navigation. From the registry, so a plugin's type needs no UI
   * change. Whether each is on is in `settings` (`plugin.<id>.enabled`).
   */
  process_types: ProcessTypeDisplay[];
  /**
   * What each switched-on hub feature says its UI needs before any page loads
   * (FeatureServer.hubConfig), by feature id: the Members plugin's
   * `{ page_shown }`, whether residents get its page and section yet. A
   * feature that is off, or says nothing, is absent.
   */
  features: Record<string, Record<string, unknown>>;
  /**
   * The hub's clock (Events 3, 2026-11-08): its time zone setting, else its
   * place's zone, else UTC, and which (src/shared/hubTimeZone.ts). What the
   * UI shows a time in; `settings["identity.timezone"]` stays the raw value.
   */
  time_zone: HubTimeZone;
  /**
   * Whether the address box suggests addresses as a member types (Mapbox is
   * set up on this deployment; 2026-11-17). False: the box is type-and-Find.
   */
  address_suggestions: boolean;
}

function publicHub(hub: Hub): PublicHub {
  return {
    id: hub.id,
    name: hub.name,
    hostname: hub.hostname,
    jurisdiction_code: hub.jurisdiction_code,
    jurisdiction_name: hub.jurisdiction_name,
    space_did: hub.space_did,
    mode: hubModeFor(hub),
  };
}

export const handleGetHubConfig = route(async (req, res) => {
  const hub = req.hub;
  if (!hub) {
    // Unreachable in practice: the resolver answers before any handler runs.
    // Explicit anyway, so a future change to middleware order fails loudly
    // instead of serving a config with no hub behind it.
    throw new NotFoundError("No civic hub is configured at this address.", "no_hub");
  }

  // A county hub with no district list of its own starts using the Census's
  // on its first page view (districts and demographics, 2026-11-17).
  await ensureCensusDistrictsBriefly(hub.id);
  const settings = await getPublicSettings(hub.id);
  const [pluginSetup, content, features] = await Promise.all([pluginSetupFor(hub.id), hubContentFlags(hub.id), featureHubConfig()]);

  // `private`, not `public`: this response differs per hostname, and a shared
  // cache that keyed it wrongly would serve one hub's identity on another's
  // domain. `no-cache` rather than a max-age since 2026-09-24: a hub admin
  // edits these values from the Settings page and expects the next reload to
  // show them. Express's ETag makes the revalidation a 304 with no body.
  res.set("Cache-Control", "private, no-cache");
  const body: HubConfigResponse = {
    hub: publicHub(hub),
    settings,
    plugin_setup: pluginSetup,
    content,
    process_types: processTypeDisplays(),
    features,
    time_zone: effectiveHubTimeZone(settings[KEYS.IDENTITY_TIMEZONE], hub.jurisdiction_code),
    address_suggestions: adapters().addressSuggest.configured(),
  };
  res.json(body);
});

/**
 * GET /hub-config/documents — the hub's legal pages and About text.
 *
 * Separate from the config because these are documents: around 30 KB between
 * them, needed by the handful of pages that render one and by nothing else.
 * Putting them in the boot payload would make every visitor download the
 * terms of service to look at the feed.
 */
export const handleGetHubDocuments = route(async (req, res) => {
  const hub = req.hub;
  if (!hub) {
    throw new NotFoundError("No civic hub is configured at this address.", "no_hub");
  }
  // Revalidated every time, for the same reason as the config: an admin who
  // edits a document expects to see it on the next reload. ETag keeps the
  // unchanged case to a 304.
  res.set("Cache-Control", "private, no-cache");
  // The draft notes ride beside the documents, not in them: the page shows
  // them to admins only (2026-10-07). They say nothing that is not true of
  // every hub's starter text, so serving them to everyone discloses nothing.
  res.json(await hubDocumentsWithNotes(hub));
});
