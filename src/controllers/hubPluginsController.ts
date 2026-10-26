// The Plugins page's installs (ADR-014): the hub's package-provided plugins
// with their versions, grants and state, and Install / Remove (Stop now or
// Wind down) / Update (ADR-015). Admin only (mounted under /admin, behind requireAdmin). The
// rules are src/services/pluginInstall.ts's.

import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import { auditActor } from "../services/hubAdminAudit.js";
import { installPlugin, listPluginInstalls, removePlugin, updatePlugin } from "../services/pluginInstall.js";

/** GET /admin/hub/plugins/installs — { plugins: PluginInstallView[] }. */
export const handleListPluginInstalls = route(async (_req, res) => {
  res.json({ plugins: await listPluginInstalls() });
});

/** POST /admin/hub/plugins/:plugin/install — the plugin, installed. */
export const handleInstallPlugin = route(async (req, res) => {
  const user = getAuthUser(res);
  res.json({ plugin: await installPlugin(String(req.params.plugin), { id: user.id, audit: auditActor(user) }) });
});

/** POST /admin/hub/plugins/:plugin/remove { mode: "stop" | "wind_down" } — the plugin, as it now is. */
export const handleRemovePlugin = route(async (req, res) => {
  const user = getAuthUser(res);
  const mode = (req.body as { mode?: unknown } | undefined)?.mode;
  res.json({ plugin: await removePlugin(String(req.params.plugin), mode, { id: user.id, audit: auditActor(user) }) });
});

/** POST /admin/hub/plugins/:plugin/update — the plugin, at the version this deployment runs. */
export const handleUpdatePlugin = route(async (req, res) => {
  const user = getAuthUser(res);
  res.json({ plugin: await updatePlugin(String(req.params.plugin), { id: user.id, audit: auditActor(user) }) });
});
