// Schema drift check — probes the database against the contract and reports
// what the running code expects but cannot find.
//
// Read-only by construction: every probe is a bounded SELECT. It never writes,
// never migrates, and never repairs. Its whole job is to make drift loud —
// once in the deploy log at startup, and continuously via GET /health.
//
// See src/db/schemaContract.ts for what is checked and why this exists.

import { getDb } from "./client.js";
import { currentRequirements, type SchemaRequirement } from "./schemaContract.js";

/** Postgres: relation (table/view) does not exist. */
const UNDEFINED_TABLE = "42P01";
/** Postgres: column does not exist. */
const UNDEFINED_COLUMN = "42703";

export interface SchemaGap {
  table: string;
  owner: string;
  kind: "missing_table" | "missing_column" | "forbidden_column";
  detail: string;
}

export interface SchemaReport {
  ok: boolean;
  checked: number;
  gaps: SchemaGap[];
  /**
   * Probes that failed for reasons that are NOT drift — connectivity, auth,
   * permissions. Reported separately and deliberately do NOT set ok:false: a
   * database we cannot reach is the ping's problem to report, and calling it
   * "drift" would send whoever reads this to the wrong place entirely.
   */
  inconclusive: Array<{ table: string; detail: string }>;
  duration_ms: number;
}

/**
 * Classify one probe error. Pure, so the mapping from Postgres error codes to
 * "this is drift" / "this is something else" is testable without a database.
 */
export function classifyProbeError(
  req: SchemaRequirement,
  error: { code?: string; message?: string } | null,
): SchemaGap | { inconclusive: string } | null {
  if (!error) return null;

  const message = error.message?.trim() || "no message";

  if (error.code === UNDEFINED_TABLE) {
    return {
      table: req.table,
      owner: req.owner,
      kind: "missing_table",
      detail: message,
    };
  }
  if (error.code === UNDEFINED_COLUMN) {
    return {
      table: req.table,
      owner: req.owner,
      kind: "missing_column",
      detail: message,
    };
  }
  return { inconclusive: message };
}

/**
 * Classify a forbidden-column probe. Inverted from the usual reading: a probe
 * that SUCCEEDS means the column is present, which is the violation, and the
 * "column does not exist" error is the healthy outcome. Pure, so the inversion
 * is pinned by a test rather than trusted.
 */
export function evaluateForbiddenProbe(
  req: SchemaRequirement,
  forbidden: { column: string; reason: string },
  error: { code?: string; message?: string } | null,
): SchemaGap | { inconclusive: string } | null {
  if (!error) {
    return {
      table: req.table,
      owner: req.owner,
      kind: "forbidden_column",
      detail: `${req.table}.${forbidden.column} EXISTS and must not — ${forbidden.reason}`,
    };
  }
  if (error.code === UNDEFINED_COLUMN) return null; // absent, as required
  return {
    inconclusive: `could not verify absence of ${forbidden.column}: ${
      error.message?.trim() || "no message"
    }`,
  };
}

/** Type guard so callers can tell a gap from an inconclusive probe. */
export function isGap(
  result: SchemaGap | { inconclusive: string } | null,
): result is SchemaGap {
  return result !== null && !("inconclusive" in result);
}

/**
 * Probe every requirement. One bounded SELECT per table — naming the required
 * columns makes Postgres itself do the checking, and limit(1) keeps the row
 * cost at zero-or-one per table.
 *
 * Note: the probe intentionally does NOT use { head: true }. A head request
 * returns the error code without a usable message, and the message is what
 * tells a half-awake operator which column is missing.
 */
export async function runSchemaCheck(
  requirements: SchemaRequirement[] = currentRequirements(),
): Promise<SchemaReport> {
  const startedAt = Date.now();
  const gaps: SchemaGap[] = [];
  const inconclusive: Array<{ table: string; detail: string }> = [];

  // Probed in parallel: these are ~30 independent single-row selects, and
  // sequentially they cost about 2.6s against a remote database — too slow to
  // sit in front of a health endpoint that monitors poll.
  const probes = await Promise.all(
    requirements.map(async (req) => {
      const selection = req.columns?.length ? req.columns.join(", ") : "*";
      const { error } = await getDb().from(req.table).select(selection).limit(1);
      return { req, error };
    }),
  );

  for (const { req, error } of probes) {
    const verdict = classifyProbeError(req, error);
    if (isGap(verdict)) {
      gaps.push(verdict);
    } else if (verdict) {
      inconclusive.push({ table: req.table, detail: verdict.inconclusive });
    }

    // Invariants held by absence. A successful select means the column is
    // THERE — which is the violation. Skipped when the table itself is
    // missing, since "no table" already reads as one clear problem.
    if (req.forbiddenColumns?.length && error?.code !== UNDEFINED_TABLE) {
      for (const forbidden of req.forbiddenColumns) {
        const probe = await getDb()
          .from(req.table)
          .select(forbidden.column)
          .limit(1);
        const verdict = evaluateForbiddenProbe(req, forbidden, probe.error);
        if (isGap(verdict)) {
          gaps.push(verdict);
        } else if (verdict) {
          inconclusive.push({ table: req.table, detail: verdict.inconclusive });
        }
      }
    }
  }

  return {
    ok: gaps.length === 0,
    checked: requirements.length,
    gaps,
    inconclusive,
    duration_ms: Date.now() - startedAt,
  };
}

let cached: SchemaReport | null = null;
let cachedAt = 0;

/**
 * A clean result is stable — the schema does not drift on its own — so it is
 * cheap to trust for a while.
 */
const CACHE_TTL_OK_MS = 5 * 60 * 1000;
/**
 * A drifted result is different: someone is very likely applying the missing
 * migration at this exact moment, and a health endpoint that keeps insisting
 * things are broken for five minutes after the fix trains people to ignore
 * it. Re-probe a red result promptly.
 */
const CACHE_TTL_DRIFT_MS = 30 * 1000;

/** How long the given report may be trusted before re-probing. */
export function cacheTtlFor(report: SchemaReport): number {
  return report.ok ? CACHE_TTL_OK_MS : CACHE_TTL_DRIFT_MS;
}

/**
 * The cached report. Serverless gives us a fresh process per cold start, so a
 * deploy always re-probes; the TTL covers long-lived warm instances and keeps
 * a hammered /health from turning into a hammered database.
 */
export async function getSchemaReport(
  opts: { force?: boolean } = {},
): Promise<SchemaReport> {
  const fresh = cached && Date.now() - cachedAt < cacheTtlFor(cached);
  if (fresh && !opts.force) return cached as SchemaReport;

  const report = await runSchemaCheck();
  cached = report;
  cachedAt = Date.now();
  return report;
}

/** Reset the cache. Tests only. */
export function resetSchemaReportCache(): void {
  cached = null;
  cachedAt = 0;
}

/**
 * Render the report for a log. Kept pure and separate from the probing so the
 * exact words an operator reads at 2am are pinned by a test.
 */
export function formatSchemaReport(report: SchemaReport): string {
  if (report.ok && report.inconclusive.length === 0) {
    return `[schema] ✓ ${report.checked} table(s) match the code (${report.duration_ms}ms)`;
  }

  const lines: string[] = [];
  if (!report.ok) {
    lines.push(
      `[schema] ❌ DRIFT — the deployed code expects ${report.gaps.length} thing(s) this database does not have. ` +
        `Apply the pending migration(s) in supabase/migrations; writes to these tables are failing right now.`,
    );
    for (const gap of report.gaps) {
      lines.push(`[schema]    ${gap.table} (${gap.owner}): ${gap.detail}`);
    }
  }
  for (const probe of report.inconclusive) {
    lines.push(
      `[schema] ⚠️  could not check ${probe.table}: ${probe.detail} (not drift — check connectivity/permissions)`,
    );
  }
  return lines.join("\n");
}

/**
 * Fire the check at startup and log the outcome. Never throws and never
 * blocks boot: a hub with drift must still start, precisely so it can serve
 * the /health response that explains what is wrong.
 */
export function validateSchemaAtStartup(): void {
  void getSchemaReport({ force: true })
    .then((report) => {
      const rendered = formatSchemaReport(report);
      if (report.ok) console.log(rendered);
      else console.error(rendered);
    })
    .catch((err) => {
      console.warn(
        `[schema] check could not run: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
