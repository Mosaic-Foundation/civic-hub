// Give the console its own database login (the console split, step 3;
// migration 20261111000000_console_schema made the civic_console role
// without one). Run once per project, by Adam, from his machine:
//
//   npx tsx scripts/console-db-login.ts dev
//   npx tsx scripts/console-db-login.ts prod
//
// It generates a password here, sets it on civic_console (ALTER ROLE … LOGIN
// PASSWORD), checks the login through Supabase's pooler (its own tables
// readable, a hub table refused), and writes the console's connection string
// to ~/civic-keys/<target>-console-db.env (mode 600). The password is never
// printed. Running it again replaces the password: update the Vercel setting
// after.
//
// Before the console-schema migration (20261111000000) has run on the project
// it makes the role itself (the migration's CREATE ROLE is "if not exists"),
// so the password and the Vercel setting can be in place before the release
// that needs them; the two checks then wait for that release.
//
// Reads the project's admin connection from ~/civic-keys: dev-db.env (dev),
// prod-pg.env (prod), CIVIC_TARGET_DATABASE_URL.

import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const target = process.argv[2];
if (target !== "dev" && target !== "prod") {
  console.error("Usage: npx tsx scripts/console-db-login.ts dev|prod");
  process.exit(2);
}
const KEYS = join(homedir(), "civic-keys");
const adminFile = join(KEYS, target === "dev" ? "dev-db.env" : "prod-pg.env");
const outFile = join(KEYS, `${target}-console-db.env`);

function readUrl(file: string): URL {
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("CIVIC_TARGET_DATABASE_URL="));
  if (!line) throw new Error(`${file} has no CIVIC_TARGET_DATABASE_URL.`);
  return new URL(line.slice("CIVIC_TARGET_DATABASE_URL=".length).trim().replace(/^["']|["']$/g, ""));
}

const admin = readUrl(adminFile);
// postgres.<project-ref> through the pooler: the ref is what follows the dot.
const ref = decodeURIComponent(admin.username).split(".")[1];
if (!ref) throw new Error(`${adminFile}: expected a pooler user "postgres.<project-ref>".`);
const expected = target === "dev" ? "urfmvqhzmamigssqwsya" : "nfhyypwoporfggqcerli";
if (ref !== expected) throw new Error(`${adminFile} points at project ${ref}, not ${target} (${expected}). Nothing changed.`);

const password = randomBytes(24).toString("base64url");

let schemaReady = false;
const a = new pg.Client({ connectionString: admin.toString(), ssl: { rejectUnauthorized: false } });
await a.connect();
try {
  const role = await a.query("SELECT 1 FROM pg_roles WHERE rolname = 'civic_console'");
  if (role.rowCount === 0) {
    // As the migration makes it; the migration's grants follow at the release.
    await a.query("CREATE ROLE civic_console NOLOGIN NOINHERIT");
    console.log("ok  made the civic_console role (the release's migration gives it its rights)");
  }
  schemaReady = (await a.query("SELECT 1 FROM pg_namespace WHERE nspname = 'console'")).rowCount === 1;
  // ALTER ROLE takes no bind parameters; the password is base64url, so quoting is safe.
  await a.query(`ALTER ROLE civic_console WITH LOGIN PASSWORD '${password}'`);
} finally {
  await a.end();
}
console.log(`ok  civic_console can log in on ${target} (${ref}); the password is set and not shown.`);

// The console runs on Vercel: the pooler's transaction mode (6543).
const consoleUrl = new URL(admin.toString());
consoleUrl.username = `civic_console.${ref}`;
consoleUrl.password = password;
consoleUrl.port = "6543";

const c = new pg.Client({ connectionString: consoleUrl.toString(), ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  if (!schemaReady) {
    await c.query("SELECT 1");
    console.log("ok  as civic_console: it can log in. Its tables arrive with the release; the console uses them from then on.");
  } else {
    const own = await c.query("SELECT count(*)::int AS n FROM console.control_sessions");
    console.log(`ok  as civic_console: its own tables answer (${own.rows[0].n} console session rows)`);
    try {
      await c.query("SELECT 1 FROM public.hubs LIMIT 1");
      throw new Error("civic_console could read public.hubs: it must not. Check the migration's grants before going on.");
    } catch (err) {
      if (err instanceof Error && /permission denied/.test(err.message)) console.log("ok  as civic_console: hub tables are refused");
      else throw err;
    }
  }
} finally {
  await c.end();
}

writeFileSync(outFile, `CIVIC_CONSOLE_DATABASE_URL=${consoleUrl.toString()}\n`, { mode: 0o600 });
chmodSync(outFile, 0o600);
console.log(`ok  saved the console's connection string to ${outFile}`);
