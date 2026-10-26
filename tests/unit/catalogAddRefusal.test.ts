// catalog:add refuses a package whose migration is not additive (plugin
// session 2, ADR-015), before it starts anything and without writing an entry:
// every hub shares the database a package's migration changes.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

describe("catalog:add", () => {
  it("refuses a package with a migration that is not additive, and writes nothing", () => {
    const before = readdirSync("supabase/migrations").length;
    const r = spawnSync("npx", ["tsx", "scripts/catalog-add.ts", "kit/conformance/fixtures/not-additive"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a migration is not additive");
    expect(r.stderr).toContain("20261026130000_drop_answered_at.sql: it drops something");
    expect(readdirSync("supabase/migrations").length).toBe(before);
  }, 60_000);
});
