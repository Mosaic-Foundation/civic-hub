// Whether this deployment runs scheduled work at all.
//
// WHY THIS EXISTS. A second deployment of the same codebase, pointed at a
// second database, inherits vercel.json — and therefore inherits every cron
// in it. The dev deployment had been live for fourteen hours when this was
// written and had already, unprompted: fetched a county government's news
// feed and created five announcement processes from it, and attempted to
// email fifty-seven people their daily digest. The only reason fifty-six of
// those did not arrive is that the sender was the provider's sandbox, which
// refuses every address but the account owner's — the very thing the same
// session was about to fix. A deployment that exists to be experimented on
// must not do a hub's real work on its behalf.
//
// ONE SWITCH, ON THE MOUNT, NOT FOUR CHECKS IN FOUR CONTROLLERS. A cron added
// next month is covered without anyone remembering to cover it, which is the
// property that matters: the failure mode here is silent and external.
//
// DEFAULT TRUE. Production is the deployment that must not have to opt in to
// working, and an operator who has never heard of this variable gets the
// behaviour they already had. It is set to false on civic-hub-dev.
//
// 200, NOT 503. Vercel Cron retries and alerts on a failed invocation, and a
// deployment that is deliberately idle is not failing. The body says
// "disabled" so a human reading the log sees a decision rather than a
// no-op that might be a bug.

import type { NextFunction, Request, Response } from "express";

/**
 * Does this deployment run its scheduled jobs?
 *
 * Read per call rather than captured at import, so a test can flip it and so
 * a serverless instance that outlives a configuration change picks it up.
 */
export function cronsEnabled(): boolean {
  return process.env.HUB_CRON_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * Short-circuit every `/internal/*` route when crons are off.
 *
 * Mounted ahead of the four cron routers, so it covers the manual-trigger
 * path as well — those routes are triggerable by hand with the CRON_SECRET,
 * and "disabled" has to mean disabled rather than "not scheduled".
 */
export function cronKillSwitch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (cronsEnabled()) {
    next();
    return;
  }
  console.log(
    `[cron] ${req.method} ${req.originalUrl} not run — HUB_CRON_ENABLED=false`,
  );
  res.status(200).type("text/plain").send("disabled");
}
