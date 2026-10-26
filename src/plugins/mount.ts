// Mounting the loaded packages' routes (ADR-014): the route mounter loop that
// ADR-009 left. Each route is mounted behind its plugin's switch (a hub that
// switched the plugin off answers 404, as before) and behind the loader's
// verdict (a package that is not mounted answers 404 on every hub).

import type { RequestHandler, Router } from "express";
import { NotFoundError } from "../errors/index.js";
import { route } from "../http/route.js";
import { requirePlugin } from "../middleware/pluginGate.js";
import type { PluginId } from "../models/hubSettings.js";
import { isPackageMounted, loadedPackages, verifyPackages } from "./loader.js";
import { draftRouter } from "../routes/draftRoutes.js";

/** 404 unless the package is mounted. */
export function requireMounted(packageName: string): RequestHandler {
  return route((_req, _res, next) => {
    if (!isPackageMounted(packageName)) throw new NotFoundError("Not found");
    next();
  });
}

/**
 * Mount every package's routes (`which` = "routes", on the app) or admin
 * routes ("adminRoutes", on the /admin router, after its admin check), in
 * configured order.
 */
export function mountPackageRoutes(on: Pick<Router, "use">, which: "routes" | "adminRoutes"): void {
  for (const p of loadedPackages()) {
    const drafts = p.server.drafts;
    const draftsPath = p.pkg.manifest.descriptor.creation.resident?.drafts;
    if (which === "routes" && drafts && draftsPath) {
      on.use(draftsPath, requirePlugin(p.plugin as PluginId), requireMounted(p.pkg.name), draftRouter(drafts.kind, drafts.extend));
    }
    for (const m of p.server[which] ?? []) {
      on.use(m.path, requirePlugin(p.plugin as PluginId), requireMounted(p.pkg.name), m.router);
    }
  }
}

/** Before any route: the loader's verdict is known (and refreshed when old). */
export const awaitPackages: RequestHandler = (_req, _res, next) => {
  verifyPackages().then(() => next(), next);
};
