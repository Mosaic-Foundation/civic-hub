// npm run catalog:add -- packages/<dir> [--port 3300] [--required] [--no-auto-install]
// npm run catalog:add -- <dir of a submitted package> [--required] [--no-auto-install]
//
// A package outside packages/ (a submission, or examples/straw-poll) is proven
// the way its developer proved it (ADR-015): the SDK and the conformance suite
// packed as npm packages (kit/scripts/pack.ts), installed into an empty folder
// outside this repository, and `civic-conformance` run against the directory.
// Its entry is written the same way; deploying it is a separate step (the
// package moves under packages/ and into config/plugins.json).
//
// The way a plugin package gets into the console's catalog (ADR-014):
//   1. checks the package's shape (npm run plugins:sync -- --check) and that
//      config/plugins.json lists it;
//   2. hashes its files (src/plugins/hash.ts): what the approval will be of,
//      and refuses a migration of its own that is not additive
//      (src/plugins/additive.ts; ADR-015): a package's migrations run once for
//      every hub, before the code;
//   3. starts this checkout's API on --port against the LOCAL stack, with the
//      outside services faked and CIVIC_PLUGINS_UNVERIFIED on (development
//      only), so the package runs before anyone has approved it;
//   4. runs the conformance suite against its type alone
//      (tests/api/conformance.test.ts with CIVIC_CONFORMANCE_TYPES);
//   5. on green, writes supabase/migrations/<now>_catalog_<id>_<version>.sql:
//      one plugin_catalog row, status 'pending', with the hash, the grant the
//      manifest declares and the conformance result. On red, writes nothing.
//      --required writes it marked required (every hub is moved to it once it
//      is approved and running; ADR-015); --no-auto-install writes it as one a
//      new hub does not get (the developer guide's example).
//
// The row is unsigned: the console signs it with that deployment's catalog key
// when the operator approves it (ADR-015). It reaches each environment with
// its migrations (before the code, as every release does) and waits there for
// the operator to approve it in the console. Until then the loader does not mount the package on that
// deployment. On the local stack and in CI, scripts/catalog-approve-local.ts
// approves it.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashPackage } from "../src/plugins/hash.js";
import { notAdditive, ungrantedTables } from "../src/plugins/additive.js";
import type { PluginPackage } from "../src/plugins/package.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message: string): never {
  console.error(`catalog:add: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** A SQL string literal. */
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

function localStack(): Record<string, string> {
  let st: Record<string, string>;
  try {
    st = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    fail("the local stack is not running (./scripts/local-stack.sh start)");
  }
  const url = st.API_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) fail(`refusing a stack that is not local (${url})`);
  return st;
}

async function waitFor(url: string, server: ChildProcess): Promise<void> {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) fail("the API exited before answering; its output is above");
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`the API did not answer ${url} within 90 seconds`);
}

/** The conformance suite against a package outside packages/, as its developer runs it. */
async function proveOutside(dir: string): Promise<void> {
  const { pack } = (await import(pathToFileURL(join(ROOT, "kit/scripts/pack.ts")).href)) as { pack(out: string): { sdk: string; conformance: string } };
  const tmp = mkdtempSync(join(tmpdir(), "civic-catalog-add-"));
  try {
    const { sdk, conformance } = pack(join(tmp, "tarballs"));
    const project = join(tmp, "project");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "catalog-add", private: true, type: "module" }) + "\n");
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", sdk, conformance], { cwd: project, stdio: "inherit" });
    execFileSync(join(project, "node_modules/.bin/civic-conformance"), [resolve(ROOT, dir), "--port", arg("--port") ?? "3300"], {
      cwd: project,
      stdio: "inherit",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
  } catch {
    fail(`the conformance suite failed for ${dir}; nothing written`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const flagValues = new Set(["--port"].map((f) => arg(f)).filter(Boolean));
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--") && !flagValues.has(a))?.replace(/\/$/, "");
  if (!dir || !existsSync(resolve(ROOT, dir, "index.ts"))) fail("usage: npm run catalog:add -- packages/<dir> | <a package directory>");
  const outside = !dir.startsWith("packages/");
  let pkg: PluginPackage;
  if (outside) {
    // Read as its developer's test host reads it; the hub here does not load
    // it. The engine first, through the loader (a package imported first would
    // reach the registry while it is still being imported).
    ((await import(pathToFileURL(join(ROOT, "src/plugins/loader.ts")).href)) as { loadedPackages(): unknown }).loadedPackages();
    pkg = ((await import(pathToFileURL(resolve(ROOT, dir, "index.ts")).href)) as { default: PluginPackage }).default;
  } else {
    const listed = (JSON.parse(readFileSync(join(ROOT, "config/plugins.json"), "utf8")) as { packages: string[] }).packages;
    if (!listed.includes(dir)) fail(`${dir} is not in config/plugins.json; add it and run npm run plugins:sync`);
    execFileSync("npx", ["tsx", "scripts/plugins-sync.ts", "--check"], { cwd: ROOT, stdio: "inherit" });

    // Through the hub's own loader, as the server loads it (a package imported
    // first would reach the registry while it is still being imported).
    const { loadedPackages } = await import(pathToFileURL(join(ROOT, "src/plugins/loader.ts")).href);
    const entry = (loadedPackages() as Array<{ dir: string; pkg: PluginPackage }>).find((p) => p.dir === dir);
    if (!entry) fail(`${dir} did not load`);
    pkg = entry.pkg;
  }
  const hash = hashPackage(resolve(ROOT, dir));
  const m = pkg.manifest;
  console.log(`catalog:add: ${pkg.name}@${pkg.version} (${m.descriptor.type}), ${hash}`);
  const migrationsDir = resolve(ROOT, dir, "migrations");
  const refused = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .flatMap((f) => {
          const sql = readFileSync(join(migrationsDir, f), "utf8");
          return [...notAdditive(`${dir}/migrations/${f}`, sql), ...ungrantedTables(`${dir}/migrations/${f}`, sql)];
        })
    : [];
  if (refused.length > 0) {
    fail(
      `a migration cannot be taken: every hub shares the database it changes (ADR-015):\n` +
        refused.map((r) => `  ${r.file}: ${r.why}: ${r.statement}`).join("\n"),
    );
  }
  const required = process.argv.includes("--required");
  const autoInstall = !process.argv.includes("--no-auto-install");

  if (outside) {
    await proveOutside(dir);
  } else {
    const st = localStack();
    const port = arg("--port") ?? "3300";
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      SUPABASE_URL: st.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY,
      SUPABASE_PUBLISHABLE_KEY: st.PUBLISHABLE_KEY ?? st.ANON_KEY ?? "",
      CIVIC_HUB_SIGNING_KEY: st.JWT_SECRET,
      NODE_ENV: "development",
      CIVIC_ALLOW_SEED: "true",
      CIVIC_ADMIN_EMAILS: "admin@example.test",
      CIVIC_DEV_HUB: "athens",
      CIVIC_JURISDICTION: "us-va-floyd",
      CIVIC_ANON_SECRET: "ci-only-anon-secret",
      CRON_SECRET: "ci-only-cron-secret",
      DIGEST_UNSUBSCRIBE_SECRET: "ci-only-digest-unsubscribe-secret",
      CIVIC_FAKE_ADAPTERS: "on",
      CIVIC_PLUGINS_UNVERIFIED: "on",
      PORT: port,
      BASE_URL: `http://localhost:${port}`,
    };
    const server = spawn("node", ["--import", "tsx", "src/index.ts"], { cwd: ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
    let passed = false;
    try {
      await waitFor(`http://localhost:${port}/health`, server);
      try {
        execFileSync("npx", ["vitest", "run", "tests/api/conformance.test.ts"], {
          cwd: ROOT,
          stdio: "inherit",
          env: { ...process.env, CIVIC_API_BASE: `http://localhost:${port}`, CIVIC_CONFORMANCE_TYPES: m.descriptor.type },
        });
        passed = true;
      } catch {
        passed = false;
      }
    } finally {
      server.kill("SIGTERM");
    }
    if (!passed) fail(`the conformance suite failed for ${m.descriptor.type}; nothing written`);
  }

  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    if (execFileSync("git", ["status", "--porcelain", "--", dir], { cwd: ROOT, encoding: "utf8" }).trim() !== "") commit += "+uncommitted";
  } catch {
    /* not a checkout */
  }
  const walked = m.descriptor.creation.resident !== null || m.descriptor.creation.admin;
  const conformance = { result: "passed", ran_at: new Date().toISOString(), commit, walked };
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = (outside ? dir.split("/").pop()! : dir.slice("packages/".length)).replace(/[^a-z0-9]/g, "_");
  const file = `supabase/migrations/${ts}_catalog_${id}_${pkg.version.replace(/\./g, "_")}.sql`;
  writeFileSync(
    join(ROOT, file),
    `-- A plugin catalog entry, written by \`npm run catalog:add\` (ADR-014). Additive.\n` +
      `-- ${pkg.name}@${pkg.version} passed the conformance suite (${commit}). The row waits,\n` +
      `-- 'pending', for the operator to approve it in the console; until then the\n` +
      `-- loader does not mount this version on the deployment. The console signs it as\n` +
      `-- it approves it (ADR-015).\n` +
      (required ? `-- Marked required: once approved and running, every hub on an older version is moved to it.\n` : "") +
      (autoInstall ? "" : `-- Not installed on new hubs (auto_install false).\n`) +
      `\nINSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)\n` +
      `VALUES (\n  ${lit(pkg.name)},\n  ${lit(pkg.version)},\n  ${lit(hash)},\n  ${lit(pkg.displayName)},\n  ${lit(m.descriptor.plugin)},\n  ${lit(m.descriptor.type)},\n` +
      `  ${lit(JSON.stringify(m.capabilities))}::jsonb,\n  ${lit(JSON.stringify(conformance))}::jsonb,\n  'pending',\n  ${required},\n  ${autoInstall}\n)\n` +
      `ON CONFLICT (package, version, hash) DO NOTHING;\n`,
  );
  console.log(`catalog:add: green. Wrote ${file}. Apply it (./scripts/local-stack.sh start), then approve the entry in the console on each deployment.`);
}

await main();
