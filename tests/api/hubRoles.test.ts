// hub_roles: roles as claims keyed by the account (20261023000000, ADR-011).
//
// The people lists stay the input; a trigger fills hub_roles. This proves:
//   - on every hub of the stack, hub_roles equals the lists as the app reads
//     them (scripts/check-hub-roles.ts's comparison, which the release runs);
//   - the backfill is idempotent: the sync, and the whole migration file, run
//     again change no row;
//   - the trigger follows every way a list or an account changes, with the
//     app's parsing rules (JSON or comma lists, case, whitespace, the legacy
//     authors key, a corrupt authors list falling back to the board);
//   - a pending grant (an address with no account) binds when the account is
//     created, unbinds when its address changes, and pends again when it goes;
//   - only the triggers write hub_roles; a change bumps the settings version.
// LOCAL ONLY (pg on the stack). Needs no server; runs in both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { checkHub } from "../../scripts/check-hub-roles.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`hubRoles: refusing ${host}; local stack only.`);
}
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "../../supabase/migrations/20261023000000_hub_roles.sql");

let db: pg.Client;
const hub = `hr-${randomBytes(4).toString("hex")}`;

interface RoleRow {
  role: string;
  granted_email: string;
  user_id: string | null;
  attrs: Record<string, string>;
}

async function roles(hubId = hub): Promise<RoleRow[]> {
  return (
    await db.query<RoleRow>(
      "SELECT role, granted_email, user_id, attrs FROM hub_roles WHERE hub_id = $1 ORDER BY role, granted_email, user_id NULLS FIRST",
      [hubId],
    )
  ).rows;
}

async function setting(key: string, value: string | null): Promise<void> {
  if (value === null) await db.query("DELETE FROM hub_settings WHERE hub_id = $1 AND key = $2", [hub, key]);
  else
    await db.query(
      "INSERT INTO hub_settings (hub_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (hub_id, key) DO UPDATE SET value = EXCLUDED.value",
      [hub, key, value],
    );
}

async function user(email: string): Promise<string> {
  const id = `user_${randomBytes(6).toString("hex")}`;
  await db.query("INSERT INTO users (id, hub_id, email, email_verified, is_resident) VALUES ($1, $2, $3, true, false)", [id, hub, email]);
  return id;
}

async function version(): Promise<number> {
  return Number((await db.query("SELECT settings_version FROM hubs WHERE id = $1", [hub])).rows[0].settings_version);
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(
    "INSERT INTO hubs (id, hostname, name, space_did, protocol_hub_id) VALUES ($1, $2, 'Roles Test Hub', $3, $1)",
    [hub, `${hub}.localhost`, `did:web:${hub}.localhost`],
  );
});

afterAll(async () => {
  if (db) {
    await db.query("DELETE FROM hub_settings WHERE hub_id = $1", [hub]);
    await db.query("DELETE FROM users WHERE hub_id = $1", [hub]);
    await db.query("DELETE FROM hubs WHERE id = $1", [hub]);
    await db.end();
  }
});

describe("hub_roles equals the people lists", () => {
  it("on every hub of the stack, as the app reads them", async () => {
    const hubs = (await db.query<{ id: string }>("SELECT id FROM hubs ORDER BY id")).rows;
    const failed: string[] = [];
    for (const h of hubs) {
      const r = await checkHub(db, h.id);
      if (!r.ok) failed.push(`${h.id}: ${JSON.stringify(r.roles)}`);
    }
    expect(failed).toEqual([]);
  });
});

describe("the backfill is idempotent", () => {
  it("running the sync again for every hub changes no row", async () => {
    const before = (await db.query("SELECT id, hub_id, role, user_id, granted_email, attrs, created_at FROM hub_roles ORDER BY id")).rows;
    await db.query("SELECT public._civic_sync_hub_roles(id) FROM hubs");
    const after = (await db.query("SELECT id, hub_id, role, user_id, granted_email, attrs, created_at FROM hub_roles ORDER BY id")).rows;
    expect(after).toEqual(before);
  });

  it("running the whole migration again changes no row", async () => {
    const before = (await db.query("SELECT id, hub_id, role, user_id, granted_email, attrs, created_at FROM hub_roles ORDER BY id")).rows;
    await db.query(readFileSync(MIGRATION, "utf8"));
    const after = (await db.query("SELECT id, hub_id, role, user_id, granted_email, attrs, created_at FROM hub_roles ORDER BY id")).rows;
    expect(after).toEqual(before);
  });
});

describe("the trigger reads the lists as the app does", () => {
  it("JSON and comma lists, case, whitespace and duplicates", async () => {
    await setting("people.admin_emails", JSON.stringify(["  Ada@Example.Test ", "ada@example.test", "", 5, "bo@example.test"]));
    await setting("people.board_emails", " Cy@Example.Test ,dee@example.test,, cy@example.test ");
    expect((await roles()).map((r) => [r.role, r.granted_email, r.user_id])).toEqual([
      ["admin", "ada@example.test", null],
      ["admin", "bo@example.test", null],
      // The board stands in for an unsaved authors list, labelled generically.
      ["announcement_author", "cy@example.test", null],
      ["announcement_author", "dee@example.test", null],
      ["board", "cy@example.test", null],
      ["board", "dee@example.test", null],
    ]);
    expect((await roles()).find((r) => r.role === "announcement_author")?.attrs).toEqual({ label: "Board member" });
    expect((await checkHub(db, hub)).ok).toBe(true);
  });

  it("an empty value reads as unset; a corrupt JSON list reads as a comma list", async () => {
    await setting("people.admin_emails", "");
    await setting("people.board_emails", '["unclosed@example.test", other@example.test');
    expect((await roles()).filter((r) => r.role !== "announcement_author").map((r) => [r.role, r.granted_email])).toEqual([
      ["board", '["unclosed@example.test"'],
      ["board", "other@example.test"],
    ]);
    expect((await checkHub(db, hub)).ok).toBe(true);
  });

  it("the authors list, by its key or its legacy one, and the board fallback when it is not a list of objects", async () => {
    await setting("people.board_emails", "board@example.test");
    await setting(
      "announcement_authors",
      JSON.stringify([
        { email: " Clerk@Example.Test ", label: " Clerk ", name: " Pat " },
        { email: "clerk@example.test", label: "Second" },
        { email: "nolabel@example.test", label: "" },
        null,
        ["array"],
      ]),
    );
    expect((await roles()).filter((r) => r.role === "announcement_author").map((r) => [r.granted_email, r.attrs])).toEqual([
      ["clerk@example.test", { label: "Clerk", name: "Pat" }],
    ]);
    // A named author, bound to an account, as the release check compares it.
    await user("clerk@example.test");
    expect((await checkHub(db, hub)).ok).toBe(true);
    // The canonical key wins over the legacy one.
    await setting("people.announcement_authors", JSON.stringify([{ email: "chair@example.test", label: "Chair" }]));
    expect((await roles()).filter((r) => r.role === "announcement_author").map((r) => r.granted_email)).toEqual(["chair@example.test"]);
    // A list that is not all objects falls back to the board, as the app does.
    await setting("people.announcement_authors", JSON.stringify([{ email: "chair@example.test", label: "Chair" }, "x"]));
    expect((await roles()).filter((r) => r.role === "announcement_author").map((r) => [r.granted_email, r.attrs])).toEqual([
      ["board@example.test", { label: "Board member" }],
    ]);
    // Unparseable falls back too.
    await setting("people.announcement_authors", "{not json");
    expect((await roles()).filter((r) => r.role === "announcement_author").map((r) => r.granted_email)).toEqual(["board@example.test"]);
    expect((await checkHub(db, hub)).ok).toBe(true);
    await setting("people.announcement_authors", null);
    await setting("announcement_authors", null);
  });
});

describe("a grant follows the account", () => {
  it("binds when the account appears, unbinds when its address changes, pends again when it goes", async () => {
    await setting("people.admin_emails", JSON.stringify(["newadmin@example.test"]));
    expect((await roles()).filter((r) => r.role === "admin")).toEqual([
      { role: "admin", granted_email: "newadmin@example.test", user_id: null, attrs: {} },
    ]);

    const id = await user("NewAdmin@Example.Test");
    expect((await roles()).filter((r) => r.role === "admin").map((r) => r.user_id)).toEqual([id]);
    expect((await checkHub(db, hub)).ok).toBe(true);

    await db.query("UPDATE users SET email = 'moved@example.test' WHERE id = $1", [id]);
    expect((await roles()).filter((r) => r.role === "admin").map((r) => r.user_id)).toEqual([null]);

    await db.query("UPDATE users SET email = 'newadmin@example.test' WHERE id = $1", [id]);
    expect((await roles()).filter((r) => r.role === "admin").map((r) => r.user_id)).toEqual([id]);

    await db.query("DELETE FROM users WHERE id = $1", [id]);
    expect((await roles()).filter((r) => r.role === "admin")).toEqual([
      { role: "admin", granted_email: "newadmin@example.test", user_id: null, attrs: {} },
    ]);
    expect((await checkHub(db, hub)).ok).toBe(true);
  });

  it("removing an address from the list removes its grant", async () => {
    const id = await user("stays@example.test");
    await setting("people.admin_emails", JSON.stringify(["stays@example.test", "goes@example.test"]));
    expect((await roles()).filter((r) => r.role === "admin").map((r) => [r.granted_email, r.user_id])).toEqual([
      ["goes@example.test", null],
      ["stays@example.test", id],
    ]);
    await setting("people.admin_emails", JSON.stringify(["stays@example.test"]));
    expect((await roles()).filter((r) => r.role === "admin").map((r) => [r.granted_email, r.user_id])).toEqual([["stays@example.test", id]]);
    await setting("people.admin_emails", null);
    expect((await roles()).filter((r) => r.role === "admin")).toEqual([]);
  });

  it("an unrelated sign-up or settings write touches nothing", async () => {
    await setting("people.admin_emails", JSON.stringify(["someone@example.test"]));
    const v = await version();
    const before = await db.query("SELECT id FROM hub_roles WHERE hub_id = $1 ORDER BY id", [hub]);
    await user("unrelated@example.test");
    await setting("identity.tagline", "A tagline");
    const after = await db.query("SELECT id FROM hub_roles WHERE hub_id = $1 ORDER BY id", [hub]);
    expect(after.rows).toEqual(before.rows);
    // The tagline write bumps the version itself, once; hub_roles adds nothing.
    expect(await version()).toBe(v + 1);
  });

  it("a change to hub_roles bumps the hub's settings version", async () => {
    const v = await version();
    await user("someone@example.test");
    expect(await version()).toBeGreaterThan(v);
  });
});

describe("only the triggers write hub_roles", () => {
  it("the hub's roles may read it and nothing else", async () => {
    const r = (
      await db.query(
        `SELECT has_table_privilege('authenticated', 'hub_roles', 'SELECT') AS a_sel,
                has_table_privilege('authenticated', 'hub_roles', 'INSERT') AS a_ins,
                has_table_privilege('authenticated', 'hub_roles', 'UPDATE') AS a_upd,
                has_table_privilege('authenticated', 'hub_roles', 'DELETE') AS a_del,
                has_table_privilege('service_role', 'hub_roles', 'INSERT') AS s_ins,
                has_table_privilege('anon', 'hub_roles', 'SELECT') AS anon_sel`,
      )
    ).rows[0];
    expect(r).toEqual({ a_sel: true, a_ins: false, a_upd: false, a_del: false, s_ins: false, anon_sel: false });
  });
});
