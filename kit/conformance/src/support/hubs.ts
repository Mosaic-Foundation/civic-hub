// Putting away the hubs a run made (the repository's test runs and the
// civic-conformance command alike): every row that carries their hub_id, the
// platform's copies of their feedback, audit rows and redemptions, in one
// transaction, with the append-only tables' triggers suspended for it.
// LOCAL STACK ONLY: the caller connects to the local database.

import pg from "pg";

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
