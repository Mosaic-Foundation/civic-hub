// @civic-raw-client-importer: test harness; it reads and deletes hub rows on the LOCAL stack only.
/**
 * Test runs put away the hubs they create (local stack hygiene, 2026-10-24).
 *
 * The global setup of vitest (vitest.config.ts) and of Playwright
 * (playwright.config.ts): at the start of a run it records which hubs exist;
 * at the end, pass or fail, it deletes every hub created since, with every row
 * that carries its hub_id (its users, events, processes, sessions, settings…),
 * the platform's copies of its feedback, its audit rows and redemptions. The
 * append-only tables' triggers are suspended for the delete, as purge and
 * restore do. Stored images are left; `scripts/local-stack.sh reset` clears them.
 *
 * Never deleted: the fixture set (athens, floyd, smoke), which
 * `scripts/local-stack.sh start` / `reset` load, and anything that existed
 * when the run began. So a session's own hubs are safe, but one made by hand
 * DURING a run is taken with the run's. One run at a time per stack.
 *
 * LOCAL ONLY: CIVIC_TEST_DATABASE_URL (default the Supabase CLI's local
 * database) must be 127.0.0.1 or localhost, or nothing is touched. With no
 * database to reach (the unit job in CI, the run-anywhere job's other port)
 * it says so in one line and does nothing.
 */

import pg from "pg";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FIXTURE_HUBS = ["athens", "floyd", "smoke"];

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

async function connect(): Promise<pg.Client | null> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => undefined);
    return null;
  }
}

async function hubIds(client: pg.Client): Promise<string[]> {
  return (await client.query<{ id: string }>("select id from hubs")).rows.map((r) => r.id);
}

/** Every row of these hubs, in one transaction, with the triggers (append-only, foreign keys) suspended. */
export async function dropHubs(client: pg.Client, ids: string[]): Promise<void> {
  const tables = (
    await client.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'hub_id' and t.table_type = 'BASE TABLE'
        order by 1`,
    )
  ).rows.map((r) => r.table_name);
  const also: Array<[string, string]> = [
    ["platform_feedback", "source_hub_id"],
    ["control_audit_log", "target_hub_id"],
    ["entitlement_redemptions", "created_hub_id"],
  ];
  await client.query("begin");
  try {
    await client.query("set local session_replication_role = replica");
    for (const t of tables) await client.query(`delete from public."${t}" where hub_id = any($1)`, [ids]);
    for (const [t, c] of also) await client.query(`delete from public."${t}" where "${c}" = any($1)`, [ids]);
    await client.query("delete from hubs where id = any($1)", [ids]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  }
}

export default async function recordHubs(): Promise<() => Promise<void>> {
  const off = (why: string) => {
    console.log(`[dropTestHubs] ${why}; the hubs this run creates are kept.`);
    return async () => undefined;
  };
  if (!isLocal(DB_URL)) return off(`refusing ${new URL(DB_URL).hostname}: local stack only`);
  const client = await connect();
  if (!client) return off("no local database to reach");
  let before: Set<string>;
  try {
    before = new Set(await hubIds(client));
  } finally {
    await client.end();
  }

  return async () => {
    const c = await connect();
    if (!c) return void console.log("[dropTestHubs] the local database went away; nothing deleted.");
    try {
      const made = (await hubIds(c)).filter((id) => !before.has(id) && !FIXTURE_HUBS.includes(id));
      if (made.length === 0) return;
      await dropHubs(c, made);
      console.log(`[dropTestHubs] deleted the ${made.length} hub(s) this run created.`);
    } finally {
      await c.end();
    }
  };
}
