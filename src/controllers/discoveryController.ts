// Discovery controller — serves the /.well-known/civic.json manifest.
//
// Shaped per the Civic Space Specification: a nested `space` object keyed by
// the space's stable DID (not its URL, which changes when a space migrates),
// the civic geography it serves, the activity feeds it publishes, and the
// process types it can run. Deliberately minimal — an indexer needs to know
// who this space is, where its stream is, and what it can do.

import { route } from "../http/route.js";
import { currentHub } from "../config/hubContext.js";
import { isProcessTypeEnabled } from "../services/pluginGate.js";
import { baseUrl } from "../utils/baseUrl.js";
import { getRegisteredTypes, publicProcessTypes } from "../processes/registry.js";
import { civicPlaceCode, hubName, spaceDid } from "../config/hub.js";
import { loadedPackages, packageVerdicts } from "../plugins/loader.js";

export const handleDiscoveryManifest = route((_req, res) => {
  const hub = baseUrl();
  const placeCode = civicPlaceCode();

  // Who stands behind the space DID (identity spec §5.3: the custody
  // arrangement MUST be disclosed in the space manifest) and the declared
  // identity assurance level (§12.4) — operator facts from the hub's own
  // row, set in the console (Architecture 3, ADR-010; Adam, 2026-10-21).
  // Omitted while undeclared; nothing here names a place in code.
  const row = currentHub();
  const space: Record<string, unknown> = {
    id: spaceDid(),
    scope: "community",
    type: "civic.hub",
  };
  if (row?.custody_arrangement || row?.custodian) {
    space.custody = {
      ...(row.custody_arrangement ? { arrangement: row.custody_arrangement } : {}),
      ...(row.custodian ? { custodian: row.custodian } : {}),
    };
  }
  if (row?.assurance_level) space.assurance_level = row.assurance_level;

  const manifest: Record<string, unknown> = {
    name: hubName(),
    space,
  };

  // Omitted entirely where this deployment has no civic geography — the same
  // rule the activity `location` property follows (Civic Activity Spec §2.2).
  if (placeCode) manifest.jurisdictions = [placeCode];

  manifest.feeds = [`${hub}/events`];
  // Only the types this hub offers: one whose plugin is switched off cannot
  // be created, read or acted on here (src/services/pluginGate.ts).
  manifest.processes = getRegisteredTypes().filter(isProcessTypeEnabled);
  // What each of those types is: the public parts of its descriptor (type,
  // version, tier, lifecycle states, actions and who may call them, event
  // types emitted). Tables, settings and adapters stay internal (Adam,
  // 2026-10-12). Additive: `processes` keeps its shape.
  manifest.process_types = publicProcessTypes(isProcessTypeEnabled);
  // The plugin packages this hub runs, with their versions (ADR-014): the
  // installed ones of those this deployment mounts. Additive. Names,
  // versions, and whether the approval this deployment runs it on carries a
  // verified signature (ADR-015); grants and hashes stay with the console.
  const verdicts = new Map(packageVerdicts().map((v) => [v.package, v]));
  manifest.plugins = loadedPackages()
    .filter((p) => isProcessTypeEnabled(p.type))
    .map((p) => ({ package: p.pkg.name, version: p.pkg.version, type: p.type, signed: verdicts.get(p.pkg.name)?.signed === true }));
  // Civic Activity Spec v0.2 §6.3: "A conformance claim names its level."
  // Level 1 (Publisher) is what this hub implements — a single validated
  // emission path serving the §6.1 collection under the §5.2 serving rule.
  // Level 2 adds ActivityPub delivery and is deliberately not implemented;
  // claiming it here would be the kind of overstatement the levels exist to
  // prevent.
  manifest.spec = {
    activity: "civic-activity-spec-v0.2",
    conformance: "level-1",
  };

  res.json(manifest);
});
