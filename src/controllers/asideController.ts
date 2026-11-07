// GET /api/aside: the right column's facts (layout session, 2026-11-07;
// ADR-019). The hub UI's own read, like /api/feed: not the spec surface.
// What it reads and why each part is public: services/aside.ts.

import { route } from "../http/route.js";
import { resolveCaller } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { readAside } from "../services/aside.js";

export const handleGetAside = route(async (req, res) => {
  const { actor } = await resolveCaller(req);
  const isAdmin = await can(actor, "hub.see_as_admin");
  res.json(await readAside({ isAdmin }));
});
