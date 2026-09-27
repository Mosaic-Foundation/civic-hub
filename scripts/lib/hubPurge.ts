// Purging a never-used hub (2026-09-27, Adam): what scripts/purge-hub.ts
// checks, plans and does. Plan: BUILD-PLAN-multi-tenant.md → "Freeing a
// never-used hub's slug".
//
// A purge is the one hard delete of a hub. It exists so a hub created by
// mistake — a typo'd slug, a test on production — does not keep its slug and
// hostname forever. It is refused for anything that was ever used:
//
//   - the hub must be archived (the console's step-up already stood between
//     the hub and the world);
//   - its only users are its admins and the synthetic sample authors;
//   - it has no process and no event that is not sample content;
//   - no other hub's redirect_to points at it.
//
// Over a direct Postgres connection (ADR-005), as the owner: the same
// service-role path restore uses. The append-only tables (events,
// review_turns, hub_admin_audit_log) are cleared with triggers suspended for
// that one statement each, and only after the export bundle holds them.
//
// ONE TRANSACTION: the hub.purge audit row (its `before` is the hub's full
// `hubs` row, created_at included, so a reused slug's two lives can be told
// apart), every hub_id row child-first, and the `hubs` row. Either all of it
// happens or none. Stored images go after the commit; a failure there is
// reported with the keys left behind.

import type pg from "pg";
import { asEmailList, KEYS } from "../../src/models/hubSettings.js";
import { APPEND_ONLY, ident, insertOrder, readCatalog } from "./hubImport.js";

export type Row = Record<string, unknown>;

export class PurgeRefused extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(message);
  }
}

export interface PurgeCheck {
  hub: Row;
  admins: string[];
  /** Why the hub may not be purged; empty when it may. */
  problems: string[];
  /** Users kept out of the "real people" count, for the plan's printout. */
  users: { admins: number; sample: number; others: Array<{ id: string; email: string }> };
}

/** Does `redirect` point at this hub (its slug, its hostname, or a URL on it)? */
export function redirectPointsAt(redirect: string | null | undefined, hub: { id: string; hostname: string }): boolean {
  const r = (redirect ?? "").trim().toLowerCase();
  if (!r) return false;
  if (r === hub.id || r === hub.hostname) return true;
  const host = r.replace(/^[a-z]+:\/\//, "").split(/[/:?#]/)[0];
  return host === hub.hostname;
}

/** Everything that decides whether a purge may run. Reads only. */
export async function checkPurge(client: pg.Client, hubId: string, env: NodeJS.ProcessEnv = process.env): Promise<PurgeCheck> {
  const hr = await client.query("select to_jsonb(h) as r from hubs h where id = $1", [hubId]);
  const hub = hr.rows[0]?.r as Row | undefined;
  if (!hub) throw new PurgeRefused(`No hub "${hubId}" in this database.`);
  const problems: string[] = [];

  if (!hub.archived_at) {
    problems.push("The hub is not archived. Archive it in the console first (it takes a fresh code).");
  }

  const ar = await client.query("select value from hub_settings where hub_id = $1 and key = $2", [hubId, KEYS.PEOPLE_ADMIN_EMAILS]);
  const admins = asEmailList(ar.rows[0]?.value ?? env.CIVIC_ADMIN_EMAILS);

  const ur = await client.query<{ id: string; email: string | null; is_sample: boolean }>(
    "select id, email, is_sample from users where hub_id = $1 order by id",
    [hubId],
  );
  const users = { admins: 0, sample: 0, others: [] as Array<{ id: string; email: string }> };
  for (const u of ur.rows) {
    if (u.is_sample) users.sample++;
    else if (u.email && admins.includes(u.email.toLowerCase())) users.admins++;
    else users.others.push({ id: u.id, email: u.email ?? "(no email)" });
  }
  if (users.others.length) {
    problems.push(
      `${users.others.length} user(s) besides its admins and the sample authors: ` +
        users.others.slice(0, 5).map((u) => u.email).join(", ") +
        (users.others.length > 5 ? ", …" : "") +
        ". A hub someone joined is not purged; it stays archived.",
    );
  }

  const pr = await client.query<{ n: number }>("select count(*)::int as n from processes where hub_id = $1 and not is_sample", [hubId]);
  if (pr.rows[0].n > 0) problems.push(`${pr.rows[0].n} process(es) that are not sample content.`);
  const er = await client.query<{ n: number }>("select count(*)::int as n from events where hub_id = $1 and not is_sample", [hubId]);
  if (er.rows[0].n > 0) problems.push(`${er.rows[0].n} event(s) that are not sample content.`);

  const rr = await client.query<{ id: string; redirect_to: string }>(
    "select id, redirect_to from hubs where id <> $1 and redirect_to is not null",
    [hubId],
  );
  const pointing = rr.rows.filter((r) => redirectPointsAt(r.redirect_to, { id: hubId, hostname: String(hub.hostname) }));
  if (pointing.length) {
    problems.push(`Hub(s) ${pointing.map((r) => `"${r.id}"`).join(", ")} redirect to it.`);
  }

  return { hub, admins, problems, users };
}

export interface PurgePlan {
  /** Every table with hub_id, child-first (the order rows are deleted in). */
  order: string[];
  /** Columns nulled first to break a foreign-key cycle (restore does the same). */
  deferred: Array<{ table: string; columns: string[] }>;
  counts: Record<string, number>;
}

/** Which tables hold the hub's rows, how many, and the order to delete them in. */
export async function planPurge(client: pg.Client, hubId: string): Promise<PurgePlan> {
  const catalog = await readCatalog(client);
  const tables = [...catalog.columns].filter(([, cols]) => cols.has("hub_id")).map(([t]) => t).sort();
  const nullable = (t: string, c: string) => catalog.columns.get(t)?.get(c)?.nullable ?? false;
  const { order, deferred } = insertOrder(tables, catalog.fks, nullable);
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.query<{ n: number }>(`select count(*)::int as n from ${ident(t)} where hub_id = $1`, [hubId]);
    counts[t] = r.rows[0].n;
  }
  return { order: [...order].reverse(), deferred, counts };
}

export interface PurgeResult {
  deleted: Record<string, number>;
  audit_id: number;
}

/**
 * The purge itself, in one transaction: the audit row first, then every
 * hub_id row child-first, then the hub. Re-checks the refusals inside the
 * transaction (with the hub row locked), so nothing changes between the
 * plan the operator read and the delete.
 */
export async function applyPurge(
  client: pg.Client,
  hubId: string,
  plan: PurgePlan,
  audit: { actor: string; after: Row },
): Promise<PurgeResult> {
  await client.query("begin");
  try {
    await client.query("select 1 from hubs where id = $1 for update", [hubId]);
    const again = await checkPurge(client, hubId);
    if (again.problems.length) throw new PurgeRefused("The hub changed since the plan was made.", again.problems);

    const a = await client.query<{ id: number }>(
      "insert into control_audit_log (actor_email, action, target_hub_id, before, after) values ($1, 'hub.purge', $2, $3, $4) returning id",
      [audit.actor, hubId, JSON.stringify(again.hub), JSON.stringify(audit.after)],
    );

    for (const d of plan.deferred) {
      await client.query(
        `update ${ident(d.table)} set ${d.columns.map((c) => `${ident(c)} = null`).join(", ")} where hub_id = $1`,
        [hubId],
      );
    }
    const deleted: Record<string, number> = {};
    for (const t of plan.order) {
      const appendOnly = APPEND_ONLY.includes(t);
      if (appendOnly) await client.query("set local session_replication_role = replica");
      const r = await client.query(`delete from ${ident(t)} where hub_id = $1`, [hubId]);
      if (appendOnly) await client.query("set local session_replication_role = origin");
      deleted[t] = r.rowCount ?? 0;
    }
    const h = await client.query("delete from hubs where id = $1", [hubId]);
    if (h.rowCount !== 1) throw new Error("the hubs row was not deleted");

    // Nothing of the hub may be left behind.
    for (const t of plan.order) {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${ident(t)} where hub_id = $1`, [hubId]);
      if (r.rows[0].n > 0) throw new Error(`${t} still has ${r.rows[0].n} row(s) for the hub`);
    }
    await client.query("commit");
    return { deleted, audit_id: a.rows[0].id };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  }
}
