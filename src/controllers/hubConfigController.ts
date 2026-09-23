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

import type { Request, Response } from "express";
import { getPublicSettings } from "../services/hubSettings.js";
import { hubDocuments } from "../services/hubDocuments.js";
import type { Hub, HubMode } from "../models/hub.js";
import { hubModeFor } from "../services/hubSettings.js";

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

export async function handleGetHubConfig(
  req: Request,
  res: Response,
): Promise<void> {
  const hub = req.hub;
  if (!hub) {
    // Unreachable in practice: the resolver answers before any handler runs.
    // Explicit anyway, so a future change to middleware order fails loudly
    // instead of serving a config with no hub behind it.
    res.status(404).json({ error: "no_hub" });
    return;
  }

  const settings = await getPublicSettings(hub.id);

  // `private`, not `public`: this response differs per hostname, and a shared
  // cache that keyed it wrongly would serve one hub's identity on another's
  // domain. Sixty seconds in the browser is all the caching this needs.
  res.set("Cache-Control", "private, max-age=60");
  const body: HubConfigResponse = { hub: publicHub(hub), settings };
  res.json(body);
}

/**
 * GET /hub-config/documents — the hub's legal pages and About text.
 *
 * Separate from the config because these are documents: around 30 KB between
 * them, needed by the handful of pages that render one and by nothing else.
 * Putting them in the boot payload would make every visitor download the
 * terms of service to look at the feed.
 */
export async function handleGetHubDocuments(
  req: Request,
  res: Response,
): Promise<void> {
  const hub = req.hub;
  if (!hub) {
    res.status(404).json({ error: "no_hub" });
    return;
  }
  res.set("Cache-Control", "private, max-age=300");
  res.json({ documents: await hubDocuments(hub) });
}
