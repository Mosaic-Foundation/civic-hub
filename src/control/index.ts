// The deployment's front door: one Express app per request, chosen by host.
//
// A request on the console hostname (CIVIC_CONSOLE_HOSTNAME) goes to the
// super admin (./router.ts) and never reaches the hub app; every other
// request goes to the hub app and never reaches this directory's routes.
// With no console hostname configured, this is the hub app, unchanged.
//
// The start page (session 4b): a request on CIVIC_START_HOSTNAME goes to
// ./startRouter.ts, likewise never to the hub app. Unset = no start page.
//
// Imported only by the entry points (api/index.ts, src/index.ts). The hub
// app, src/app.ts and everything it pulls in, may not import src/control/
// (eslint rule civic/control-boundary).
//
// The console split (Seam-Audit-2026-11-10.md): the console reaches hubs only
// through the operator API (src/operator/api.ts), handed in here. The entry
// points pass the in-process one; with CIVIC_OPERATOR_URL set the console
// calls the hub deployment over HTTPS instead, as it will from its own
// deployment (eslint rule civic/console-seam).

import express, { type Express } from "express";
import { env } from "../config/env.js";
import type { OperatorApi } from "../operator/api.js";
import { httpOperator } from "./operatorClient.js";
import { isConsoleHost, isStartHost } from "./config.js";
import { controlRouter } from "./router.js";
import { startRouter } from "./startRouter.js";
import { clientErrorsRouter } from "../http/clientErrors.js";
import { healthHandler } from "../http/health.js";

/** The operator API the console uses: the hub deployment over HTTPS when CIVIC_OPERATOR_URL is set, else `local`. */
export function consoleOperator(local: OperatorApi): OperatorApi {
  const url = env.CIVIC_OPERATOR_URL;
  const token = env.CIVIC_OPERATOR_TOKEN;
  if (url && token) return httpOperator(url, token);
  return local;
}

export function withConsole(hubApp: Express, local: OperatorApi): Express {
  const front = express();
  front.disable("x-powered-by");
  const op = consoleOperator(local);
  const control = controlRouter(op);
  const start = startRouter(op);
  // Every hostname: a browser's error report (src/http/clientErrors.ts), and
  // /health for the console and the start page, which uptime monitoring
  // checks like any hub (the hub app serves its own).
  front.use(clientErrorsRouter());
  front.get("/health", (req, res, next) => {
    if (isConsoleHost(req.headers.host) || isStartHost(req.headers.host)) return healthHandler(req, res, next);
    next();
  });
  front.use((req, res, next) => {
    if (isConsoleHost(req.headers.host)) {
      control(req, res, next);
      return;
    }
    if (isStartHost(req.headers.host)) {
      start(req, res, next);
      return;
    }
    hubApp(req, res, next);
  });
  return front;
}
