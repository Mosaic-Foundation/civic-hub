// Does every hub's hub_roles say what its people lists say? The one-time
// coverage check before any authorization check reads hub_roles (Adam, Q1 of
// Architecture 4; ADR-011), kept for every later release that touches the
// lists or the trigger.
//
//   node --env-file=.env --env-file=<file naming CIVIC_TARGET_DATABASE_URL> --import tsx \
//     scripts/check-hub-roles.ts [--hub <slug>]... [--json <file>]
//
// For each hub it reads the settings and the accounts, parses the lists with
// the app's own reader (peopleListsFrom, src/services/hubSettings.ts), and
// expects, for every listed address: a row bound to each account whose
// lowercased address matches it (the people the old email checks recognised),
// or one pending row when no account has it. It prints the counts per hub and
// fails (exit 1) on any missing or extra row. READ-ONLY: SELECTs only.
//
// Uses pg rather than PostgREST (ADR-005), like scripts/wire-snapshot.ts.

import { writeFileSync } from "node:fs";
import pg from "pg";
import { peopleListsFrom } from "../src/services/hubSettings.js";

function args(name: string): string[] {
  const out: string[] = [];
  const argv = process.argv.slice(2);
  argv.forEach((a, i) => {
    if (a === name && argv[i + 1]) out.push(argv[i + 1]);
    else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
  });
  return out;
}

type Role = "admin" | "board" | "announcement_author";

interface RoleCounts {
  listed: number;
  bound: number;
  pending: number;
  missing: string[];
  extra: string[];
}

export interface HubRolesReport {
  hub: string;
  roles: Record<Role, RoleCounts>;
  ok: boolean;
}

/**
 * One row as a comparable string: role, address, account (or pending), attrs
 * with its keys sorted (jsonb hands them back in its own order).
 */
function key(role: string, email: string, userId: string | null, attrs: unknown): string {
  const a = (attrs ?? {}) as Record<string, unknown>;
  const sorted = Object.fromEntries(Object.keys(a).sort().map((k) => [k, a[k]]));
  return JSON.stringify([role, email, userId, sorted]);
}

export async function checkHub(client: pg.Client, hubId: string): Promise<HubRolesReport> {
  const settings = (await client.query<{ key: string; value: string }>("SELECT key, value FROM hub_settings WHERE hub_id = $1", [hubId])).rows;
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  const lists = peopleListsFrom(map);

  const users = (await client.query<{ id: string; email: string | null }>("SELECT id, email FROM users WHERE hub_id = $1 AND email IS NOT NULL", [hubId])).rows;
  const byEmail = new Map<string, string[]>();
  for (const u of users) {
    const e = (u.email as string).toLowerCase();
    byEmail.set(e, [...(byEmail.get(e) ?? []), u.id]);
  }

  const wanted: Record<Role, Array<{ email: string; attrs: Record<string, string> }>> = {
    admin: lists.admins.map((email) => ({ email, attrs: {} })),
    board: lists.board.map((email) => ({ email, attrs: {} })),
    announcement_author: lists.authors.map((a) => ({
      email: a.email.toLowerCase(),
      attrs: a.name ? { label: a.label, name: a.name } : ({ label: a.label } as Record<string, string>),
    })),
  };

  const rows = (
    await client.query<{ role: Role; granted_email: string; user_id: string | null; attrs: unknown }>(
      "SELECT role, granted_email, user_id, attrs FROM hub_roles WHERE hub_id = $1 AND source = 'people_list'",
      [hubId],
    )
  ).rows;

  const report: HubRolesReport = { hub: hubId, roles: {} as Record<Role, RoleCounts>, ok: true };
  for (const role of ["admin", "board", "announcement_author"] as const) {
    const expected = new Set<string>();
    let bound = 0;
    let pending = 0;
    for (const w of wanted[role]) {
      const accounts = byEmail.get(w.email) ?? [];
      if (accounts.length === 0) {
        expected.add(key(role, w.email, null, w.attrs));
        pending += 1;
      } else {
        for (const id of accounts) expected.add(key(role, w.email, id, w.attrs));
        bound += accounts.length;
      }
    }
    const actual = new Set(rows.filter((r) => r.role === role).map((r) => key(role, r.granted_email, r.user_id, r.attrs)));
    const missing = [...expected].filter((k) => !actual.has(k));
    const extra = [...actual].filter((k) => !expected.has(k));
    if (missing.length || extra.length) report.ok = false;
    report.roles[role] = { listed: wanted[role].length, bound, pending, missing, extra };
  }
  return report;
}

async function main(): Promise<void> {
  const url = process.env.CIVIC_TARGET_DATABASE_URL;
  if (!url) {
    console.error("check-hub-roles: needs CIVIC_TARGET_DATABASE_URL");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const reports: HubRolesReport[] = [];
  try {
    await client.query("SET default_transaction_read_only = on");
    const wanted = args("--hub");
    const hubs = (
      await client.query<{ id: string }>(
        wanted.length > 0 ? "SELECT id FROM hubs WHERE id = ANY($1) ORDER BY id" : "SELECT id FROM hubs ORDER BY id",
        wanted.length > 0 ? [wanted] : [],
      )
    ).rows;
    for (const h of hubs) {
      const r = await checkHub(client, h.id);
      reports.push(r);
      const line = (["admin", "board", "announcement_author"] as const)
        .map((role) => `${role} ${r.roles[role].listed} listed / ${r.roles[role].bound} bound / ${r.roles[role].pending} pending`)
        .join("; ");
      console.log(`[check-hub-roles] ${r.ok ? "ok  " : "FAIL"} ${h.id}: ${line}`);
      for (const role of ["admin", "board", "announcement_author"] as const) {
        for (const m of r.roles[role].missing) console.log(`    missing ${m}`);
        for (const x of r.roles[role].extra) console.log(`    extra   ${x}`);
      }
    }
  } finally {
    await client.end();
  }
  const json = args("--json")[0];
  if (json) writeFileSync(json, JSON.stringify(reports, null, 2));
  const failed = reports.filter((r) => !r.ok);
  console.log(`[check-hub-roles] ${reports.length} hubs, ${failed.length} with a mismatch`);
  if (failed.length) process.exit(1);
}

if (process.argv[1]?.endsWith("check-hub-roles.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
