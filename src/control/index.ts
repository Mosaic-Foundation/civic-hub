// The deployment's front door: one Express app per request, chosen by host.
//
// A request on the console hostname (CIVIC_CONSOLE_HOSTNAME) goes to the
// super admin (./router.ts) and never reaches the hub app; every other
// request goes to the hub app and never reaches this directory's routes.
// With no console hostname configured, this is the hub app, unchanged.
//
// Imported only by the entry points (api/index.ts, src/index.ts). The hub
// app, src/app.ts and everything it pulls in, may not import src/control/
// (eslint rule civic/control-boundary): this directory is the one web
// surface meant to hold the service-role key's power over every hub.
// (It is not yet the only code that can READ the key — see
// BUILD-PLAN-multi-tenant.md → Phase 5 → "Deferred, not done".)

import express, { type Express } from "express";
import { isConsoleHost } from "./config.js";
import { controlRouter } from "./router.js";

export function withConsole(hubApp: Express): Express {
  const front = express();
  front.disable("x-powered-by");
  const control = controlRouter();
  front.use((req, res, next) => {
    if (isConsoleHost(req.headers.host)) {
      control(req, res, next);
      return;
    }
    hubApp(req, res, next);
  });
  return front;
}
