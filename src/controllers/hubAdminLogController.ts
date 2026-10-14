import { route } from "../http/route.js";
import { listHubAdminLog } from "../services/hubAdminAudit.js";

/** GET /admin/hub/admin-log: Settings → Admin log, newest first. */
export const handleGetHubAdminLog = route(async (_req, res) => {
  res.json({ entries: await listHubAdminLog() });
});
