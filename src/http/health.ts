// GET /health (and /api/health on Vercel): is this deployment, and the hub
// whose hostname was asked, able to serve?
//
// Uptime monitors read the status code, not the body (RUNBOOK-operations.md):
// 200 only when the database answers, the host's hub's own database check
// passes and the schema has no gaps; 503 otherwise, so a monitor fails on a
// real problem and not only on a dead server.
//
// Served by the hub app (src/app.ts) and, for the console and start page
// hostnames, by the front door (src/control/index.ts). A host with no hub
// (the console) reports the database and schema, and the hub check's mode only.

import type { Request, Response } from "express";
import { route } from "./route.js";
import { pingDb, pingHubDb } from "../db/health.js";
import { getSchemaReport } from "../db/schemaCheck.js";
import { deploymentCommit, deploymentId } from "../config/deployment.js";
import { normalizeHostname, resolveHubForHostname } from "../middleware/hub.js";
import { packageVerdicts, verifyPackages } from "../plugins/loader.js";

export interface HealthParts {
  db: { ok: boolean };
  hubDb: { ok: boolean };
  schema: { ok: boolean; checked: number; gaps: ReadonlyArray<{ table: string; detail: string }> };
}

/** The status code and the verdict. Pure; pinned by tests/unit/health.test.ts. */
export function healthVerdict(parts: HealthParts): { code: 200 | 503; status: "ok" | "degraded" } {
  const healthy = parts.db.ok && parts.hubDb.ok && parts.schema.ok && parts.schema.gaps.length === 0;
  return healthy ? { code: 200, status: "ok" } : { code: 503, status: "degraded" };
}

export const healthHandler = route(async (req: Request, res: Response) => {
  const db = await pingDb();
  // Phase 3: which role hub queries run as, and that a minted token for this
  // host's hub verifies. /health is hub-exempt, so the host is looked up here;
  // a host with no hub reports the mode only.
  const healthHub = await resolveHubForHostname(normalizeHostname(req.headers.host ?? req.hostname)).catch(
    () => null,
  );
  const hubDb = await pingHubDb(healthHub?.id ?? null);
  // Connectivity is not correctness: the ping passed throughout the
  // 2026-08-22 waitlist outage while every write to that table failed. The
  // schema report is what makes "deployed code vs applied migrations" visible.
  const schema = await getSchemaReport().catch((err) => ({
    ok: true as const,
    checked: 0,
    gaps: [],
    inconclusive: [{ table: "*", detail: err instanceof Error ? err.message : String(err) }],
    duration_ms: 0,
  }));
  const verdict = healthVerdict({ db, hubDb, schema });
  // Plugin packages the loader did not mount (ADR-014): listed, never a 503.
  // Prevention already happened (the package is not running); the console's
  // dashboard shows the gap, and the loader reported it.
  await verifyPackages();
  const packages = packageVerdicts();
  // A monitor polls this every few minutes: never a cached answer.
  res.setHeader("Cache-Control", "no-store");
  res.status(verdict.code).json({
    status: verdict.status,
    db,
    hub_db: hubDb,
    schema: {
      ok: schema.ok,
      checked: schema.checked,
      // Only the gaps travel in the response — enough to name the missing
      // column, not enough to enumerate the schema to an anonymous caller.
      gaps: schema.gaps.map((g) => `${g.table}: ${g.detail}`),
    },
    // The deployed commit, so "is the latest code actually live?" is answered
    // in one request: compare it to `git rev-parse HEAD` locally. Vercel's
    // variable or a generic one (src/config/deployment.ts).
    plugins: {
      mounted: packages.filter((p) => p.mounted).length,
      unmounted: packages.filter((p) => !p.mounted).map((p) => ({ package: p.package, version: p.version, reason: p.reason })),
    },
    commit: deploymentCommit(),
    deployed_at: deploymentId(),
    timestamp: new Date().toISOString(),
  });
});
