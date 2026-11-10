// A release's approval of first-party catalog entries (ADR-015 amendment,
// console slice, 2026-11-10).
//
//   node --env-file=<db env> --env-file=<release secret env> --import tsx \
//     scripts/catalog-release-approve.ts --console <url> --commit <sha> [--check]
//
// For each package this checkout runs whose catalog entry on the target is
// not approved, it decides, and says, one of:
//   approve  name@version              first-party (packages/, @civic-social/),
//                                      CI green on <sha>, and the entry's
//                                      fingerprint is the files at <sha>;
//   pending  name@version  <reason>    anything else: the operator approves
//                                      it in the console, as before.
// Without --check it then asks the console (POST /control/plugins/release-
// approve, CIVIC_RELEASE_SECRET as the bearer) to approve the first kind; the
// console signs them with its own key, exactly as its Approve does. The key
// never leaves the server. READ-ONLY on the database (one SELECT).
//
// scripts/release.sh runs it after the migrations; the pause for the operator
// remains for whatever is still pending. The working tree must be clean at
// <sha> (release.sh checks), so the files hashed here are the commit's.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPackage } from "../src/plugins/hash.js";
import { isFirstPartyName } from "../src/shared/firstParty.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CI's verdict on the commit: the run of ci.yml for it. */
export type CiState = "success" | "failure" | "running" | "missing";

export interface Candidate {
  name: string;
  version: string;
  /** The fingerprint of the package's files at the released commit. */
  localHash: string;
  /** The target's catalog entries for this version: hash and status. */
  entries: ReadonlyArray<{ hash: string; status: string }>;
}

export type Decision = { approve: true; hash: string } | { approve: false; reason: string };

const CI_WORDS: Record<Exclude<CiState, "success">, string> = {
  failure: "CI failed on this commit",
  running: "CI has not finished on this commit",
  missing: "CI has not run on this commit (push it, and wait for CI)",
};

/** Whether a release may approve this entry, and if not, why (pure; tested). */
export function decide(c: Candidate, ci: CiState): Decision {
  if (!isFirstPartyName(c.name)) return { approve: false, reason: "not first-party: the operator approves it in the console" };
  if (ci !== "success") return { approve: false, reason: CI_WORDS[ci] };
  const pending = c.entries.filter((e) => e.status === "pending");
  if (c.entries.length === 0) return { approve: false, reason: "no catalog entry for this version on the target (npm run catalog:add)" };
  const match = pending.find((e) => e.hash === c.localHash);
  if (!match) {
    if (c.entries.some((e) => e.hash === c.localHash)) {
      return { approve: false, reason: `its entry is ${c.entries.find((e) => e.hash === c.localHash)!.status}, not pending` };
    }
    return {
      approve: false,
      reason: `fingerprint mismatch: the catalog has ${c.entries.map((e) => e.hash).join(", ")}, the files at this commit are ${c.localHash} (run npm run catalog:add again)`,
    };
  }
  return { approve: true, hash: match.hash };
}

/** ci.yml's run for the commit, through the GitHub CLI. */
export function ciStateOf(commit: string): CiState {
  let out: string;
  try {
    out = execFileSync("gh", ["run", "list", "--commit", commit, "--workflow", "ci.yml", "--json", "status,conclusion", "--limit", "5"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "missing";
  }
  const runs = JSON.parse(out) as Array<{ status: string; conclusion: string }>;
  if (runs.length === 0) return "missing";
  if (runs.some((r) => r.status === "completed" && r.conclusion === "success")) return "success";
  if (runs.some((r) => r.status !== "completed")) return "running";
  return "failure";
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.CIVIC_TARGET_DATABASE_URL?.trim();
  if (!url) throw new Error("catalog-release-approve: CIVIC_TARGET_DATABASE_URL is not set (pass the deployment's env file)");
  const commit = arg("--commit");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("catalog-release-approve: --commit <the full sha being released>");
  const check = process.argv.includes("--check");
  const consoleUrl = arg("--console");

  const list = JSON.parse(readFileSync(join(ROOT, "config/plugins.json"), "utf8")) as { packages: string[] };
  const wanted = list.packages.map((dir) => {
    const pj = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { name: string; version: string };
    return { dir, name: pj.name, version: pj.version };
  });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let rows: Array<{ package: string; version: string; hash: string; status: string }>;
  try {
    ({ rows } = await client.query("select package, version, hash, status from plugin_catalog where package = any($1::text[])", [wanted.map((w) => w.name)]));
  } finally {
    await client.end();
  }

  const candidates: Candidate[] = wanted
    .filter((w) => !rows.some((r) => r.package === w.name && r.version === w.version && r.status === "approved"))
    .map((w) => ({
      name: w.name,
      version: w.version,
      localHash: hashPackage(resolve(ROOT, w.dir)),
      entries: rows.filter((r) => r.package === w.name && r.version === w.version),
    }));
  if (candidates.length === 0) return;

  const ci = ciStateOf(commit);
  const decided = candidates.map((c) => ({ c, d: decide(c, ci) }));
  const approvable = decided.filter((x) => x.d.approve);
  for (const { c, d } of decided) {
    if (!d.approve) console.log(`pending ${c.name}@${c.version} ${d.reason}`);
  }
  if (check || approvable.length === 0) {
    for (const { c } of approvable) console.log(`approve ${c.name}@${c.version}`);
    return;
  }

  const secret = process.env.CIVIC_RELEASE_SECRET?.trim();
  if (!consoleUrl || !secret) {
    const why = !consoleUrl ? "no --console address" : "CIVIC_RELEASE_SECRET is not in the release's secret file";
    for (const { c } of approvable) console.log(`pending ${c.name}@${c.version} ${why}: the operator approves it in the console`);
    return;
  }
  const res = await fetch(`${consoleUrl.replace(/\/$/, "")}/api/control/plugins/release-approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, "x-civic-console": "1" },
    body: JSON.stringify({
      commit: commit.slice(0, 7),
      entries: approvable.map(({ c, d }) => ({ package: c.name, version: c.version, hash: (d as { hash: string }).hash })),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    for (const { c } of approvable) console.log(`pending ${c.name}@${c.version} the console refused the release (HTTP ${res.status}: ${text.slice(0, 200)})`);
    return;
  }
  const body = JSON.parse(text) as { entries: Array<{ package: string; version: string; result: string; reason?: string }> };
  for (const e of body.entries) {
    console.log(e.result === "approved" ? `approved ${e.package}@${e.version}` : `pending ${e.package}@${e.version} ${e.reason ?? ""}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
