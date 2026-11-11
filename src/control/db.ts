// The console's own database connection (the console split, step 3b): a
// direct Postgres connection as civic_console (CIVIC_CONSOLE_DATABASE_URL),
// a login with rights on the `console` schema only (20261111000000). The
// console's sessions, codes, audit log, invites and start-page sessions live
// there; hub data it reaches only through the operator API. The database,
// not just the code, refuses anything else.
//
// On Vercel the URL is Supabase's pooler in transaction mode (port 6543):
// one small pool per serverless instance, no prepared statements kept.

import pg from "pg";
import { env } from "../config/env.js";
import { CivicError } from "../errors/index.js";

let pool: pg.Pool | null = null;

/** No login set: the console and the start page say so (503); the hubs are unaffected. */
export class ConsoleDbNotConfigured extends CivicError {
  constructor() {
    super(503, "console_db_not_configured", "The console cannot reach its own data: CIVIC_CONSOLE_DATABASE_URL is not set (scripts/console-db-login.ts).");
  }
}

function connectionOptions(url: string): pg.PoolConfig {
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  return {
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    // Supabase's pooler presents its own certificate chain; the connection is
    // still encrypted. A local stack has no TLS.
    ssl: local ? false : { rejectUnauthorized: false },
  };
}

function consolePool(): pg.Pool {
  if (pool) return pool;
  const url = env.CIVIC_CONSOLE_DATABASE_URL?.trim();
  if (!url) throw new ConsoleDbNotConfigured();
  pool = new pg.Pool(connectionOptions(url));
  // An idle client's error (the pooler closed it) must not crash the process.
  pool.on("error", (err) => console.warn("[console-db] idle connection error:", err.message));
  return pool;
}

/** Run one statement as civic_console. */
export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return consolePool().query<T>(sql, params);
}

/** Close the pool (tests, scripts). */
export async function closeConsoleDb(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end();
}
