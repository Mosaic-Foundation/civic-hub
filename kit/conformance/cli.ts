// civic-conformance: the Civic Hub plugin conformance suite against a package
// directory (plugin session 2, ADR-015), with Node, Docker and the Supabase
// CLI, and nothing of the hub but @civic-social/plugin-sdk, which carries the
// hub's engine as its test host.
//
//   npx civic-conformance stack                 start the local stack (the hub's database), once
//   npx civic-conformance <package dir> [--port 3400] [--keep]
//
// For a package directory it:
//   1. checks its shape (package.json, index.ts, manifest.ts, ui.tsx; name and
//      version agree), what it imports (the SDK by name, its own files, Node's
//      built-ins, its peer dependencies), and that its migrations are additive;
//   2. puts a copy of it in the test host's configured list and applies its
//      migrations to the local stack;
//   3. starts the test host with the package mounted unverified (it has no
//      catalog entry yet; development only) and the outside services faked;
//   4. makes two throwaway hubs, a beta and a demo, and walks the package's
//      process type through the suite on them (./src/runConformance.ts);
//   5. puts everything back: the hubs and every row they hold, the package's
//      tables (unless --keep), the test host's list.
// It exits 0 when the suite passes, 1 when it does not or a check refused it.
// Local stack only: it refuses any database that is not on this machine.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { HOST_ROOT } from "@civic-social/plugin-sdk/host";
import { fenceProblems } from "./src/fence.js";

const KIT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
/** The test host's scheduler secret: the suite runs its close job with it. Local only. */
const CRON = "conformance-only-cron-secret";
/** tsx, as this package resolves it: the test host's TypeScript runs through it. */
const TSX = import.meta.resolve("tsx");

function fail(message: string): never {
  console.error(`civic-conformance: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Run a command in the test host, its output shown; throws on failure. */
function inHost(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const r = spawnSync(cmd, args, { cwd: HOST_ROOT, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

interface Stack {
  apiUrl: string;
  dbUrl: string;
  serviceRoleKey: string;
  publishableKey: string;
  jwtSecret: string;
}

function localStack(): Stack {
  const r = spawnSync("supabase", ["status", "-o", "json", "--workdir", HOST_ROOT], { encoding: "utf8" });
  if (r.status !== 0) fail("the local stack is not running. Start it with `npx civic-conformance stack` (Docker must be running).");
  const st = JSON.parse(r.stdout) as Record<string, string>;
  for (const url of [st.API_URL, st.DB_URL]) {
    const host = new URL(url ?? "http://nowhere").hostname;
    if (host !== "127.0.0.1" && host !== "localhost") fail(`refusing a stack that is not on this machine (${url})`);
  }
  return {
    apiUrl: st.API_URL!,
    dbUrl: st.DB_URL!,
    serviceRoleKey: st.SERVICE_ROLE_KEY!,
    publishableKey: st.PUBLISHABLE_KEY ?? st.ANON_KEY ?? "",
    jwtSecret: st.JWT_SECRET!,
  };
}

async function waitFor(url: string, server: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) fail("the test host exited before answering; its output is above");
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`the test host did not answer ${url} within two minutes`);
}

/** What the package says it is: its manifest's type, plugin and tables, read in a child (the manifest is TypeScript). */
function describe(copyDir: string): { type: string; tables: string[] } {
  const script = `import(${JSON.stringify(pathToFileURL(join(copyDir, "manifest.ts")).href)}).then((m) => { const x = m.default; process.stdout.write(JSON.stringify({ type: x.descriptor.type, tables: x.tables.map((t) => t.name) })); })`;
  const r = spawnSync(process.execPath, ["--import", TSX, "--input-type=module", "-e", script], { cwd: HOST_ROOT, encoding: "utf8" });
  if (r.status !== 0) fail(`its manifest could not be read:\n${r.stderr}`);
  return JSON.parse(r.stdout) as { type: string; tables: string[] };
}

async function stack(): Promise<void> {
  const r = spawnSync("supabase", ["start", "--workdir", HOST_ROOT], { stdio: "inherit" });
  if (r.status !== 0) fail("supabase start failed (output above). Is Docker running?");
  console.log("civic-conformance: the local stack is up. Run `npx civic-conformance <package dir>`.");
}

async function main(): Promise<void> {
  const first = process.argv[2];
  if (first === "stack") return stack();
  if (!first || first.startsWith("-")) fail("usage: npx civic-conformance <package dir> [--port 3400] [--keep] | npx civic-conformance stack");
  const dir = resolve(first);
  if (existsSync(join(HOST_ROOT, ".git"))) {
    fail("this is the hub's own repository; run it from a project where @civic-social/plugin-sdk is installed (npm install).");
  }

  // 1. Shape, imports, migrations.
  for (const f of ["package.json", "index.ts", "manifest.ts", "ui.tsx"]) {
    if (!existsSync(join(dir, f))) fail(`${f} is missing (docs/BUILD-A-PLUGIN.md, "What a package is")`);
  }
  const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
  if (!pj.name || !/^@[a-z0-9-]+\/[a-z0-9._-]+$/.test(pj.name)) fail('package.json needs an npm "name" with a scope: "@you/plugin-name"');
  if (!pj.version || !/^\d+\.\d+\.\d+$/.test(pj.version)) fail('package.json needs a "version" like "0.1.0"');
  const fence = fenceProblems(dir);
  if (fence.length > 0) fail(`what it imports:\n${fence.map((p) => `  ${p.file}: "${p.spec}": ${p.why}`).join("\n")}`);
  type Refusal = { file: string; statement: string; why: string };
  const { notAdditive, ungrantedTables } = (await import(pathToFileURL(join(HOST_ROOT, "src/plugins/additive.ts")).href)) as {
    notAdditive(file: string, sql: string): Refusal[];
    ungrantedTables(file: string, sql: string): Refusal[];
  };
  const migrationsDir = join(dir, "migrations");
  const migrations = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort() : [];
  const refused = migrations.flatMap((f) => {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    return [...notAdditive(`migrations/${f}`, sql), ...ungrantedTables(`migrations/${f}`, sql)];
  });
  if (refused.length > 0) fail(`a migration cannot be taken, and every hub shares the database:\n${refused.map((r) => `  ${r.file}: ${r.why}: ${r.statement}`).join("\n")}`);
  console.log(`civic-conformance: ${pj.name}@${pj.version}: shape, imports and migrations checked`);

  // 2. Into the test host's list.
  const st = localStack();
  const slug = `submitted.${pj.name.slice(1).replace(/[^a-z0-9]+/g, "_")}`;
  const copyDir = join(HOST_ROOT, "packages", slug);
  const listFile = join(HOST_ROOT, "config", "plugins.json");
  const original = `${listFile}.orig`;
  if (!existsSync(original)) cpSync(listFile, original);
  const list = JSON.parse(readFileSync(original, "utf8")) as { packages: string[] };
  rmSync(copyDir, { recursive: true, force: true });
  cpSync(dir, copyDir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.git)([/\\]|$)/.test(src) });
  // A new version of a package the host already ships (Events 2): the
  // submitted copy takes the listed one's place, as an update would, rather
  // than mapping the same type twice.
  const nameOf = (d: string) => {
    try {
      return (JSON.parse(readFileSync(join(HOST_ROOT, d, "package.json"), "utf8")) as { name?: string }).name;
    } catch {
      return undefined;
    }
  };
  const replaced = list.packages.filter((d) => nameOf(d) === pj.name);
  if (replaced.length > 0) console.log(`civic-conformance: ${pj.name} replaces the host's own ${replaced.join(", ")} for this run`);
  writeFileSync(
    listFile,
    JSON.stringify({ packages: [...list.packages.filter((d) => !replaced.includes(d)), `packages/${slug}`] }, null, 2) + "\n",
  );

  const db = new pg.Client({ connectionString: st.dbUrl });
  await db.connect();
  const hubsBefore = new Set((await db.query<{ id: string }>("select id from hubs")).rows.map((r) => r.id));
  let server: ChildProcess | null = null;
  let tablesMade: string[] = [];
  let status = 1;
  const port = arg("--port") ?? "3400";
  try {
    inHost(process.execPath, ["--import", TSX, "scripts/plugins-sync.ts", "--no-migrations"]);
    const { type, tables } = describe(copyDir);
    const existing = new Set(
      (await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)", [tables])).rows.map((r) => r.table_name),
    );
    // A migration must apply more than once (Events 2): the suite applies a
    // package's migrations to a stack that may already have them (its own
    // earlier run, or a hub that ships it), and drops only the tables it made.
    // So each is applied twice in a transaction that is rolled back first, and
    // one that cannot be is refused by name, before anything else runs.
    for (const f of migrations) {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      try {
        await db.query("BEGIN");
        await db.query(sql);
        await db.query(sql);
      } catch (err) {
        await db.query("ROLLBACK");
        throw new Error(
          `${f} does not apply twice: ${(err as Error).message}. Make each statement re-runnable (IF NOT EXISTS; ` +
            "CREATE OR REPLACE TRIGGER; a function created inside DO $$ … IF to_regprocedure(…) IS NULL … $$).",
        );
      }
      await db.query("ROLLBACK");
    }
    for (const f of migrations) await db.query(readFileSync(join(migrationsDir, f), "utf8"));
    tablesMade = tables.filter((t) => !existing.has(t));
    await db.query("NOTIFY pgrst, 'reload schema'");
    console.log(`civic-conformance: ${type}: ${migrations.length} migration(s) applied to the local stack`);

    // 3. The test host.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      SUPABASE_URL: st.apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: st.serviceRoleKey,
      SUPABASE_PUBLISHABLE_KEY: st.publishableKey,
      CIVIC_HUB_SIGNING_KEY: st.jwtSecret,
      NODE_ENV: "development",
      CIVIC_ADMIN_EMAILS: "admin@example.test",
      CIVIC_CONSOLE_HOSTNAME: "console.localhost",
      CIVIC_CONSOLE_ADMIN_EMAIL: "operator@example.test",
      CIVIC_ANON_SECRET: "conformance-only-anon-secret",
      CRON_SECRET: CRON,
      DIGEST_UNSUBSCRIBE_SECRET: "conformance-only-digest-secret",
      CIVIC_FAKE_ADAPTERS: "on",
      CIVIC_PLUGINS_UNVERIFIED: "on",
      PORT: port,
      BASE_URL: `http://localhost:${port}`,
    };
    server = spawn(process.execPath, ["--import", TSX, "src/index.ts"], { cwd: HOST_ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
    await waitFor(`http://localhost:${port}/health`, server);

    // 4. Two throwaway hubs, and the suite on them.
    process.env.CIVIC_API_BASE = `http://localhost:${port}`;
    process.env.SUPABASE_URL = st.apiUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = st.serviceRoleKey;
    const { consoleCall, mintConsoleSession } = await import("./src/support/console.js");
    const cookie = await mintConsoleSession();
    const run = Date.now().toString(36);
    const hubs: Record<"BETA" | "DEMO", string> = { BETA: "", DEMO: "" };
    for (const [key, mode] of [["BETA", "beta"], ["DEMO", "demo"]] as const) {
      const slugOf = `conformance-${run}-${mode}`;
      const admin = `admin+${slugOf}@example.test`;
      const made = await consoleCall("POST", "/control/hubs", {
        cookie,
        body: { slug: slugOf, name: `Conformance ${mode}`, hostname: `${slugOf}.localhost`, admin_email: admin, hub_kind: "organization", mode },
      });
      if (made.status !== 201) fail(`the test host would not make a ${mode} hub: ${made.status} ${JSON.stringify(made.body)}`);
      hubs[key] = `${slugOf} ${slugOf}.localhost ${admin}`;
    }
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const r = spawnSync(process.execPath, [vitest, "run", "--config", join(KIT, "vitest.config.ts")], {
      cwd: KIT,
      stdio: "inherit",
      env: {
        ...process.env,
        CIVIC_CONFORMANCE_TYPES: type,
        CIVIC_CONFORMANCE_BETA: hubs.BETA,
        CIVIC_CONFORMANCE_DEMO: hubs.DEMO,
        CIVIC_TEST_DATABASE_URL: st.dbUrl,
        // The deadline steps run the close job as the hub's scheduler does.
        CIVIC_TEST_CRON_SECRET: CRON,
      },
    });
    status = r.status ?? 1;
    console.log(status === 0 ? `civic-conformance: ${pj.name}@${pj.version} (${type}) passed` : `civic-conformance: ${pj.name}@${pj.version} (${type}) did not pass`);
  } finally {
    // 5. Everything back as it was.
    server?.kill("SIGTERM");
    const { dropHubs } = await import("./src/support/hubs.js");
    const made = (await db.query<{ id: string }>("select id from hubs")).rows.map((r) => r.id).filter((id) => !hubsBefore.has(id));
    if (made.length > 0) await dropHubs(db, made);
    if (!process.argv.includes("--keep")) {
      for (const t of tablesMade) await db.query(`DROP TABLE IF EXISTS public."${t}" CASCADE`);
    }
    await db.end();
    cpSync(original, listFile);
    rmSync(copyDir, { recursive: true, force: true });
    inHost(process.execPath, ["--import", TSX, "scripts/plugins-sync.ts", "--no-migrations"]);
  }
  process.exit(status);
}

await main();
