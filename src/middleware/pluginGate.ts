// requirePlugin(id): the routes of a plugin a hub switched off answer 404,
// as if they had never been mounted — not 403, which would say the feature
// exists and the caller is merely not allowed. Mounted AFTER resolveHub, so
// the hub in scope is the request's. See src/services/pluginGate.ts.

import type { NextFunction, Request, Response } from "express";
import { isPluginEnabledSync } from "../services/hubSettings.js";
import type { PluginId } from "../models/hubSettings.js";

export function requirePlugin(plugin: PluginId) {
  return function pluginGate(_req: Request, res: Response, next: NextFunction): void {
    if (isPluginEnabledSync(plugin)) {
      next();
      return;
    }
    res.status(404).json({ error: "Not found" });
  };
}
