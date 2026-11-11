// The console's database login on the local stack and in CI (the console
// split, step 3b): civic_console gets a fixed, local-only password, so the
// console's servers can use
//   CIVIC_CONSOLE_DATABASE_URL=postgresql://civic_console:local-console-only@127.0.0.1:54322/postgres
// Refuses any database that is not on 127.0.0.1 or localhost. A deployment's
// login is made by scripts/console-db-login.ts, with a generated password.

import pg from "pg";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const LOCAL_CONSOLE_PASSWORD = "local-console-only";

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

if (!isLocal(DB_URL)) {
  console.error("console-db-local: refusing a database that is not on 127.0.0.1 or localhost");
  process.exit(2);
}
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
try {
  await client.query(`ALTER ROLE civic_console WITH LOGIN PASSWORD '${LOCAL_CONSOLE_PASSWORD}'`);
  console.log("console-db-local: civic_console can log in (local password)");
} finally {
  await client.end();
}
