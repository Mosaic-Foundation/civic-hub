// A package's migrations are additive only (plugin session 2, ADR-015):
// `npm run catalog:add` refuses one that is not (src/plugins/additive.ts).

import { describe, expect, it } from "vitest";
import { notAdditive, statements, ungrantedTables } from "../../src/plugins/additive.js";

const ok = (sql: string) => expect(notAdditive("m.sql", sql)).toEqual([]);
const refused = (sql: string, why: RegExp) => {
  const found = notAdditive("m.sql", sql);
  expect(found.length, sql).toBeGreaterThan(0);
  expect(found[0]!.why).toMatch(why);
};

describe("additive migrations", () => {
  it("allows new tables, columns, indexes, functions, policies, grants and rows", () => {
    ok(`
      -- A straw poll's answers.
      CREATE TABLE IF NOT EXISTS straw_poll_answers (hub_id text NOT NULL, process_id text NOT NULL, user_id text NOT NULL, choice text NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS straw_poll_answers_one ON straw_poll_answers (hub_id, process_id, user_id);
      SELECT public._civic_apply_hub_policy('public.straw_poll_answers');
      ALTER TABLE straw_poll_answers ADD COLUMN IF NOT EXISTS answered_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE straw_poll_answers ADD CONSTRAINT straw_choice_chk CHECK (choice <> '') NOT VALID;
      COMMENT ON TABLE straw_poll_answers IS 'one answer per resident; do not drop or update this by hand';
      CREATE FUNCTION public.straw_count(p text) RETURNS integer LANGUAGE sql AS $$ DELETE FROM x; SELECT 1 $$;
      GRANT SELECT ON straw_poll_answers TO service_role;
      INSERT INTO straw_poll_answers VALUES ('h', 'p', 'u', 'yes');
    `);
  });

  it("refuses a drop, a rename, a changed column, a rewrite, a revoke and a replaced function", () => {
    refused("DROP TABLE straw_poll_answers;", /drops/);
    refused("ALTER TABLE straw_poll_answers DROP COLUMN choice;", /drops/);
    refused("ALTER TABLE straw_poll_answers RENAME COLUMN choice TO answer;", /renames/);
    refused("ALTER TABLE straw_poll_answers ALTER COLUMN choice TYPE integer USING 0;", /existing column/);
    refused("ALTER TABLE straw_poll_answers ALTER COLUMN answered_at SET NOT NULL;", /existing column/);
    refused("TRUNCATE straw_poll_answers;", /empties/);
    refused("DELETE FROM straw_poll_answers WHERE true;", /deletes/);
    refused("UPDATE straw_poll_answers SET choice = 'no';", /rewrites/);
    refused("REVOKE SELECT ON straw_poll_answers FROM service_role;", /privilege/);
    refused("ALTER TABLE straw_poll_answers ADD CONSTRAINT c CHECK (choice <> '');", /NOT VALID/);
    refused("CREATE OR REPLACE FUNCTION public.straw_count(p text) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;", /replaces/);
  });

  it("reads past comments, strings and function bodies", () => {
    expect(statements("SELECT 'a; DROP TABLE x'; /* DROP */ SELECT 2; -- DROP\nCREATE FUNCTION f() RETURNS void AS $f$ BEGIN DROP TABLE y; END $f$ LANGUAGE plpgsql;")).toEqual([
      "SELECT ''",
      "SELECT 2",
      "CREATE FUNCTION f() RETURNS void AS $$ LANGUAGE plpgsql",
    ]);
  });

  it("a table must be granted to the hub's roles in the migration that makes it", () => {
    const table = "CREATE TABLE IF NOT EXISTS public.straw_poll_answers (hub_id text NOT NULL);";
    const found = ungrantedTables("m.sql", table);
    expect(found).toHaveLength(1);
    expect(found[0]!.why).toMatch(/without granting it/);
    expect(found[0]!.why).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.straw_poll_answers TO authenticated, service_role");
    // The guarded form the portability rule asks for, as the straw poll does.
    expect(ungrantedTables("m.sql", `${table}
      DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.straw_poll_answers TO authenticated, service_role;
      END IF; END $$;`)).toEqual([]);
    // A grant in a comment, or to another table, does not count.
    expect(ungrantedTables("m.sql", `${table} -- GRANT ALL ON straw_poll_answers TO service_role;`)).toHaveLength(1);
    expect(ungrantedTables("m.sql", `${table} GRANT SELECT ON public.other TO service_role;`)).toHaveLength(1);
  });
});
