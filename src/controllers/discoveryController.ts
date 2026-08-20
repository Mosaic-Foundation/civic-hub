// Discovery controller — serves the /.well-known/civic.json manifest.
//
// Shaped per the Civic Space Specification: a nested `space` object keyed by
// the space's stable DID (not its URL, which changes when a space migrates),
// the civic geography it serves, the activity feeds it publishes, and the
// process types it can run. Deliberately minimal — an indexer needs to know
// who this space is, where its stream is, and what it can do.

import { Request, Response } from "express";
import { baseUrl } from "../utils/baseUrl.js";
import { getRegisteredTypes } from "../processes/registry.js";
import { civicPlaceCode, hubName, spaceDid } from "../config/hub.js";

export function handleDiscoveryManifest(_req: Request, res: Response): void {
  const hub = baseUrl();
  const placeCode = civicPlaceCode();

  const manifest: Record<string, unknown> = {
    name: hubName(),
    space: {
      id: spaceDid(),
      scope: "community",
      type: "civic.hub",
    },
  };

  // Omitted entirely where this deployment has no civic geography — the same
  // rule the activity `location` property follows (Civic Activity Spec §2.2).
  if (placeCode) manifest.jurisdictions = [placeCode];

  manifest.feeds = [`${hub}/events`];
  manifest.processes = getRegisteredTypes();
  manifest.spec = { activity: "civic-activity-spec-v0.2" };

  res.json(manifest);
}
