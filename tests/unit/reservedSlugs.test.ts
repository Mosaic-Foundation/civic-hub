// The reserved-slug list is one list in code (src/models/hub.ts). The
// database's hubs_id_not_reserved_check holds the original ten; this keeps
// the two from drifting apart in the direction that matters: every name the
// constraint refuses, the validator refuses too, with a stated purpose.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESERVED_HUB_SLUGS,
  RESERVED_HUB_SLUG_PURPOSES,
  hubSlugRejectionReason,
} from "../../src/models/hub.js";

const MIGRATION = resolve(__dirname, "../../supabase/migrations/20260922010000_hubs.sql");

function constraintNames(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const m = sql.match(/hubs_id_not_reserved_check[\s\S]*?NOT IN\s*\(([^)]*)\)/i);
  if (!m) throw new Error("hubs_id_not_reserved_check not found in the hubs migration");
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("reserved hub slugs", () => {
  it("every name the database constraint refuses is in the code list", () => {
    const names = constraintNames();
    expect(names.length).toBe(10);
    for (const n of names) expect(RESERVED_HUB_SLUGS).toContain(n);
  });

  it("includes the names added on 2026-09-26", () => {
    for (const n of [
      "demo-hub", "citizendashboard", "floyd",
      "console", "control", "superadmin", "platform",
      "status", "docs", "help", "support", "blog", "billing", "auth", "login", "id",
    ]) {
      expect(hubSlugRejectionReason(n), n).toContain("reserved");
    }
  });

  it("every name says what it is for", () => {
    for (const [name, purpose] of Object.entries(RESERVED_HUB_SLUG_PURPOSES)) {
      expect(purpose.trim().length, name).toBeGreaterThan(3);
    }
  });

  it("the rejection names the purpose", () => {
    expect(hubSlugRejectionReason("console")).toContain("super admin");
  });
});
