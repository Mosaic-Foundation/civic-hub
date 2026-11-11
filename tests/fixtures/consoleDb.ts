// The console's own tables on the local stack (the console split, step 3):
// schema `console`, which PostgREST does not serve, read and written here
// with a direct connection. Local stack only. Timestamps come back as ISO
// strings, as PostgREST gave them, so tests read rows as before.

import { localSql } from "../../kit/conformance/src/support/localStack.js";

export async function consoleSql<T extends Record<string, unknown> = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const rows = await localSql(sql, params);
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))) as T[];
}
