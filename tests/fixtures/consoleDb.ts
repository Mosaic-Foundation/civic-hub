// The console's own tables on the local stack (the console split, step 3):
// schema `console`, which PostgREST does not serve, read and cleared here
// with a direct connection. Local stack only.

import pg from "pg";

const URL_ = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Run one statement against the local stack's database. */
export async function consoleSql<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const host = new URL(URL_).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("consoleSql: local stack only");
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}
