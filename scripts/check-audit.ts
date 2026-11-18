/**
 * `npm audit --audit-level=high`, with a short list of named, dated exceptions.
 *
 *   npx tsx scripts/check-audit.ts          # the backend (this folder)
 *   npx tsx scripts/check-audit.ts ui       # the UI
 *
 * CI's "Backend audit" and "UI audit" steps run this. A high or critical
 * advisory fails the step, exactly as `npm audit --audit-level=high` did,
 * unless it is in EXCEPTIONS below. npm audit has no way to ignore one
 * advisory, which is why this script exists.
 *
 * An exception is for an advisory with no patched version to move to (so an
 * `overrides` entry in package.json cannot fix it) and must say why and until
 * when. It stops applying on its `until` date, so the step fails again and
 * someone looks. An exception that no longer matches anything in the audit
 * also fails the step: the fix has arrived, so delete the entry.
 *
 * Moderate and low advisories are listed by `npm audit` and do not fail CI,
 * as before.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

interface AuditException {
  /** The advisory's GHSA id, as in its github.com/advisories URL. */
  id: string;
  reason: string;
  /** YYYY-MM-DD. From this date the exception no longer applies. */
  until: string;
}

// None right now. GHSA-fc5q-39xc-vjpf (picomatch <=4.0.7, via vite and vitest)
// was excepted from 2026-11-17 to 2026-11-18, when npm audit stopped matching
// it against picomatch 4.0.7 (the installed version), so it was deleted here.
const EXCEPTIONS: AuditException[] = [];

const BLOCKING = new Set(["high", "critical"]);

interface Advisory {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
}

const dir = path.resolve(process.argv[2] ?? ".");
const today = new Date().toISOString().slice(0, 10);

const run = spawnSync("npm", ["audit", "--json"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let report: { vulnerabilities?: Record<string, { via: (Advisory | string)[] }> };
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(`[check-audit] npm audit in ${dir} did not return JSON (exit ${run.status}).`);
  console.error(run.stderr || run.stdout);
  process.exit(1);
}

// Each advisory once, from the `via` entries that are advisories rather than
// package names (a package is "high" only because of an advisory below it).
const advisories = new Map<string, Advisory>();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === "string" || !via.url) continue;
    advisories.set(via.url, via);
  }
}

const ghsa = (a: Advisory) => a.url?.split("/").pop() ?? "";
const active = EXCEPTIONS.filter((e) => e.until > today);
const expired = EXCEPTIONS.filter((e) => e.until <= today);

const failures: string[] = [];
const excused: string[] = [];
for (const a of advisories.values()) {
  if (!BLOCKING.has(a.severity ?? "")) continue;
  const line = `${a.severity} ${a.name} ${a.range ?? ""}: ${a.title} (${a.url})`;
  if (active.some((e) => e.id === ghsa(a))) excused.push(line);
  else failures.push(line);
}

const found = new Set([...advisories.values()].map(ghsa));
for (const e of active) {
  if (!found.has(e.id)) {
    failures.push(`exception ${e.id} matches nothing in this audit any more: the fix is in, delete it from scripts/check-audit.ts`);
  }
}
for (const e of expired) {
  if (found.has(e.id)) failures.push(`exception ${e.id} expired on ${e.until}: check for a patched release, then fix or re-date it`);
}

for (const line of excused) console.log(`[check-audit] excepted (temporary): ${line}`);
if (failures.length > 0) {
  console.error(`[check-audit] ${dir}: ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  console.error("Run `npm audit` there for the full report.");
  process.exit(1);
}
console.log(`[check-audit] ${dir}: no high or critical advisories outside the exceptions.`);
