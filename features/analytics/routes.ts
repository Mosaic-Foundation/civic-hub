// The Activity feature's routes (ADR-016).
//
// On the hub, beside the event stream (not in it):
//   GET /analytics?period=week|month|quarter|all&at=YYYY-MM-DD
//       The hub's numbers for the period holding `at` (default today), as
//       JSON, small numbers hidden. Answers when the hub's admin turned
//       Public numbers on, or to a reporting key (Authorization: Bearer
//       csr_…), whose every read is logged. Otherwise 404; a bad or revoked
//       key 401.
//
// Under /admin (the admin check, then the feature's switch):
//   GET  /admin/analytics              the same report, exact
//   GET  /admin/analytics/csv          the same, as CSV
//   POST /admin/analytics/refresh      recount now (the job's work for this hub)
//   GET  /admin/analytics/keys         the keys (never a key itself) and the read log
//   POST /admin/analytics/keys         issue one: {organisation, contact, purpose} → the key, once
//   POST /admin/analytics/keys/:id/revoke

import { Router, type Request } from "express";
import {
  route,
  getAuthUser,
  getSettingSync,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  type FeatureHost,
} from "../../src/sdk/index.js";
import { isDay, isPeriodKind, type PeriodKind } from "./periods.js";
import { buildReport, resolvePeriod } from "./report.js";
import { reportCsv } from "./csv.js";
import { issueKey, keyOfRequest, listKeys, listReads, logRead, revokeKey } from "./keys.js";
import { rollup } from "./rollup.js";

export const PUBLIC_NUMBERS_KEY = "plugin.analytics.public_numbers";

export function publicNumbersOn(): boolean {
  return getSettingSync(PUBLIC_NUMBERS_KEY) === "true";
}

function periodQuery(req: Request): { kind: PeriodKind; at: string | null } {
  const kind = req.query.period ?? "month";
  const at = req.query.at ?? null;
  if (!isPeriodKind(kind)) throw new ValidationError("period must be week, month, quarter or all");
  if (at !== null && !isDay(at)) throw new ValidationError("at must be a date, YYYY-MM-DD");
  return { kind, at };
}

export function publicRouter(host: FeatureHost): Router {
  const router = Router();
  router.get(
    "/",
    route(async (req, res) => {
      const key = await keyOfRequest(host, req.get("authorization"));
      if (key === "refused") throw new UnauthorizedError("This reporting key is not valid");
      if (!key && !publicNumbersOn()) throw new NotFoundError("Not found");
      const q = periodQuery(req);
      const report = await buildReport(host, { ...q, exact: false, now: new Date() });
      if (key) {
        const { period } = await resolvePeriod(host, q.kind, q.at, new Date());
        await logRead(host, key, period);
      }
      res.set("Cache-Control", "no-store");
      res.json(report);
    }),
  );
  return router;
}

export function adminRouter(host: FeatureHost): Router {
  const router = Router();
  router.get(
    "/",
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(await buildReport(host, { ...periodQuery(req), exact: true, now: new Date() }));
    }),
  );
  router.get(
    "/csv",
    route(async (req, res) => {
      const report = await buildReport(host, { ...periodQuery(req), exact: true, now: new Date() });
      res.set("Cache-Control", "no-store");
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="activity-${report.period.kind}-${report.period.start}.csv"`);
      res.send(reportCsv(report));
    }),
  );
  router.post(
    "/refresh",
    route(async (_req, res) => {
      res.json(await rollup(host, new Date()));
    }),
  );
  router.get(
    "/keys",
    route(async (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ keys: await listKeys(host), reads: await listReads(host) });
    }),
  );
  router.post(
    "/keys",
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.status(201).json(await issueKey(host, (req.body ?? {}) as Record<string, unknown>, getAuthUser(res).id));
    }),
  );
  router.post(
    "/keys/:id/revoke",
    route(async (req, res) => {
      res.json(await revokeKey(host, String(req.params.id), getAuthUser(res).id));
    }),
  );
  return router;
}
