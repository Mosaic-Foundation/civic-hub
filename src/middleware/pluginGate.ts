// requirePlugin(id): the routes of a plugin a hub switched off answer 404,
// as if they had never been mounted — not 403, which would say the feature
// exists and the caller is merely not allowed. Mounted AFTER resolveHub, so
// the hub in scope is the request's. See src/services/pluginGate.ts.

import { NotFoundError } from "../errors/index.js";
import { route } from "../http/route.js";
import { isPluginEnabledSync } from "../services/hubSettings.js";
import type { PluginId } from "../models/hubSettings.js";

export function requirePlugin(plugin: PluginId) {
  return route((_req, _res, next) => {
    if (!isPluginEnabledSync(plugin)) throw new NotFoundError("Not found");
    next();
  });
}
