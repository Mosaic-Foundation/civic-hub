import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Phase 2c portability items from the exit-rights audit.
 *
 * 1. A GRANT to Supabase's role names (authenticated, service_role) must be
 *    behind a check that the role exists, so the migration set replays on
 *    plain Postgres, where those roles do not exist, instead of failing at the
 *    first grant. Checked statically here; the guarded forms are proven to
 *    still grant by every `supabase start` (CI's api-tests job).
 * 2. The post-images bucket is created by a migration, keyed on <hub_id>/.
 * 3. /health's commit and deployment id have generic fallbacks.
 */

const DIR = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(new URL(f, DIR), "utf8");

/** Strip `--` comments, keeping line structure. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("migrations replay on plain Postgres", () => {
  it("every GRANT to a Supabase role is inside a role-existence check", () => {
    const unguarded: string[] = [];
    for (const f of files) {
      const sql = code(read(f));
      const re = /grant\b[^;]*?\bto\s+[^;]*\b(authenticated|service_role|anon)\b/gi;
      for (let m = re.exec(sql); m; m = re.exec(sql)) {
        // The nearest enclosing block opener before the grant must check pg_roles.
        const before = sql.slice(0, m.index);
        const block = before.slice(Math.max(before.lastIndexOf("$$"), 0));
        if (!/pg_roles\s+where\s+rolname\s*=\s*'authenticated'/i.test(block)) {
          unguarded.push(`${f}: ${m[0].slice(0, 70).replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("the post-images bucket and its hub-prefix rules come from a migration", () => {
    const f = files.find((x) => x.includes("post_images_bucket"));
    expect(f).toBeDefined();
    const sql = code(read(f!));
    expect(sql).toMatch(/insert into storage\.buckets[\s\S]*'post-images'[\s\S]*on conflict \(id\) do nothing/i);
    expect(sql).toMatch(/to_regclass\('storage\.buckets'\) is null/i);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(sql).toMatch(new RegExp(`for ${op} to authenticated`, "i"));
    }
    expect((sql.match(/\(storage\.foldername\(name\)\)\[1\] = public\.current_hub_id\(\)/g) ?? []).length).toBe(5);
  });
});

describe("deployment identity outside Vercel", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads Vercel's variables where set, the generic ones otherwise", async () => {
    const { deploymentCommit, deploymentId } = await import("../../src/config/deployment.js");
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.GIT_COMMIT_SHA;
    delete process.env.DEPLOYMENT_ID;
    expect(deploymentCommit()).toBe("unknown");
    expect(deploymentId()).toBeNull();

    process.env.GIT_COMMIT_SHA = "abc123";
    process.env.DEPLOYMENT_ID = "self-hosted-7";
    expect(deploymentCommit()).toBe("abc123");
    expect(deploymentId()).toBe("self-hosted-7");

    process.env.VERCEL_GIT_COMMIT_SHA = "vercel-sha";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_1";
    expect(deploymentCommit()).toBe("vercel-sha");
    expect(deploymentId()).toBe("dpl_1");
  });

  it("nothing else in src/ reads a VERCEL_ variable directly", () => {
    const hits: string[] = [];
    const walk = (dir: URL) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
        if (e.isDirectory()) walk(u);
        else if (e.name.endsWith(".ts") && !u.pathname.endsWith("config/deployment.ts")) {
          if (/process\.env\.VERCEL_/.test(readFileSync(u, "utf8"))) hits.push(u.pathname);
        }
      }
    };
    walk(new URL("../../src/", import.meta.url));
    expect(hits).toEqual([]);
  });
});
