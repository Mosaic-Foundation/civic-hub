// GET /process/:id/breakdowns — a finished process's totals by district, age
// group and race (each only if the hub asks), one group at a time, every
// group under 5 hidden (src/services/breakdowns.ts). Public, like the
// process's own results; empty while the process is open.

import { route } from "../http/route.js";
import { breakdownsFor } from "../services/breakdowns.js";

export const handleGetBreakdowns = route(async (req, res) => {
  res.json({ breakdowns: await breakdownsFor(String(req.params.id)) });
});
