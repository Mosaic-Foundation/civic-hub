// Vercel serverless function — wraps the Express app.
//
// All /api/* requests are routed here by vercel.json.
// We strip the /api prefix so Express routes match (e.g., /api/process → /process).
// The Express app auto-seeds on first import (cold start).

import type { IncomingMessage, ServerResponse } from "http";
import hubApp from "../src/app.js";
import { withConsole } from "../src/control/index.js";

// The super admin answers on its own hostname; everything else is the hub
// app. See src/control/index.ts.
const app = withConsole(hubApp);

/**
 * Raise the function timeout to 300s (5 min) so the meeting-summary
 * cron can process a backfill batch (Floyd's 2026 meetings, roughly
 * 4–8 entries at 10–30s apiece) within a single invocation. Vercel Pro
 * supports up to 300; Enterprise allows longer. Applies to every route
 * served by this function, not just the cron — fine because the other
 * routes finish in milliseconds.
 */
export const maxDuration = 300;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Strip /api prefix so Express routes match their registered paths
  req.url = req.url!.replace(/^\/api/, "") || "/";

  // Let Express handle it
  app(req, res);
}
