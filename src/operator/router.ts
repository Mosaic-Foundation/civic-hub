// The operator API over HTTP (./api.ts): POST /operator/rpc/<method> with
// { "args": [...] }, answered { "result": ... } or, refused, { error, code }
// with the refusal's status. The console (Mosaic-Foundation/mosaic-console) calls it.
//
// The credential is CIVIC_OPERATOR_TOKEN as a bearer. Unset: every path
// here answers 404, as if it did not exist; the console on the same
// deployment calls the hub in-process. Compared in constant time: unlike
// the cron secret, this one opens every hub's data.
//
// Mounted by src/app.ts before hub resolution: the operator API belongs to
// the deployment, not to any one hub, so it answers on any of its hostnames.

import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { env } from "../config/env.js";
import { CivicError } from "../errors/index.js";
import { logUnexpected, newRef } from "../http/route.js";
import { flushErrors } from "../utils/errorTracking.js";
import { OPERATOR_METHODS, type OperatorApi, type OperatorMethod } from "./api.js";

/** Bodies are small JSON except a create form's and a catalog note; well under this. */
const BODY_LIMIT = "256kb";

export function operatorAuthorized(authorization: string | undefined, token = env.CIVIC_OPERATOR_TOKEN): boolean {
  if (!token) return false;
  const header = authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function isMethod(name: string): name is OperatorMethod {
  return (OPERATOR_METHODS as readonly string[]).includes(name);
}

export function operatorRouter(api: () => OperatorApi): Router {
  const r = express.Router();
  r.use("/operator", (req, res, next) => {
    if (!env.CIVIC_OPERATOR_TOKEN) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!operatorAuthorized(req.headers.authorization)) {
      res.status(401).json({ error: "Not the console.", code: "unauthorized" });
      return;
    }
    next();
  });
  r.post("/operator/rpc/:method", express.json({ limit: BODY_LIMIT }), (req: Request, res: Response) => {
    const name = String(req.params.method);
    if (!isMethod(name)) {
      res.status(404).json({ error: `No operator method "${name}".`, code: "not_found" });
      return;
    }
    const args = (req.body as { args?: unknown } | undefined)?.args ?? [];
    if (!Array.isArray(args)) {
      res.status(400).json({ error: "Send { \"args\": [...] }.", code: "invalid_request" });
      return;
    }
    const impl = api();
    const fn = impl[name] as (...a: unknown[]) => Promise<unknown>;
    fn.apply(impl, args)
      .then((result) => {
        res.setHeader("Cache-Control", "no-store");
        res.json({ result: result === undefined ? null : result });
      })
      .catch(async (err: unknown) => {
        if (err instanceof CivicError && err.status < 500) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        const ref = newRef();
        const status = err instanceof CivicError ? err.status : 500;
        logUnexpected(req, err, status, ref, !(err instanceof CivicError));
        await flushErrors();
        res.status(status).json({
          error: err instanceof CivicError ? err.message : "The hub could not do that.",
          code: err instanceof CivicError ? err.code : "internal_error",
          ref,
        });
      });
  });
  r.use("/operator", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  return r;
}
