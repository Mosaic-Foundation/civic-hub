// The function contract (src/db/functionContract.ts) cannot drift from the code
// or from the migrations (Audit 4):
//
//   - every `.rpc("name", …)` in src/ and api/ names a function in the contract,
//     and every function in the contract is called somewhere;
//   - the newest definition of each contract function in supabase/migrations
//     has exactly the contract's arguments, so the code never names a
//     signature no migration creates (the cheap half of the release guard;
//     RUNBOOK-release.md);
//   - compareFunctions() reports missing, mismatched and overloaded functions.
//
// Scripts (scripts/) are operator tools run against a database by hand; their
// calls (tenancy_catalog) are not part of what a deploy needs.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { compareFunctions, FUNCTION_CATALOG, FUNCTION_CONTRACT } from "../../src/db/functionContract.js";

const ROOT = join(import.meta.dirname, "..", "..");

/** Files that pass a caller's function name through rather than naming one. */
const PASS_THROUGH = new Set(["src/db/forHub.ts"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

interface RpcCall {
  file: string;
  line: number;
  name: string | null;
}

/** Every `.rpc` call in a source text, with the literal name it passes (or null). */
export function findRpcCalls(file: string, text: string): RpcCall[] {
  const calls: RpcCall[] = [];
  const re = /\.rpc\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length;
    const skipSpace = () => {
      while (i < text.length && /\s/.test(text[i])) i++;
    };
    skipSpace();
    if (text[i] === "<") {
      // Skip the type argument, which can nest (Array<{ … }>).
      let depth = 0;
      for (; i < text.length; i++) {
        if (text[i] === "<") depth++;
        else if (text[i] === ">" && text[i - 1] !== "=") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      skipSpace();
    }
    if (text[i] !== "(") continue; // a property read, not a call
    i++;
    skipSpace();
    if (text[i] === ")") continue; // `.rpc()` in prose: a call always names its function
    const literal = /^["'`]([A-Za-z0-9_]+)["'`]/.exec(text.slice(i));
    const ident = /^([A-Za-z0-9_]+)\b/.exec(text.slice(i));
    const name = literal ? literal[1] : ident?.[1] === "FUNCTION_CATALOG" ? FUNCTION_CATALOG : null;
    calls.push({ file, line: text.slice(0, m.index).split("\n").length, name });
  }
  return calls;
}

const calls = ["src", "api"].flatMap((dir) =>
  tsFiles(join(ROOT, dir)).flatMap((path) => findRpcCalls(relative(ROOT, path), readFileSync(path, "utf8"))),
);

/** Postgres's spelling of a type, as pg_get_function_identity_arguments() prints it. */
function canonicalType(type: string): string {
  const t = type.trim().toLowerCase().replace(/\s+/g, " ");
  const array = t.endsWith("[]");
  const base = array ? t.slice(0, -2).trim() : t;
  const names: Record<string, string> = {
    timestamptz: "timestamp with time zone",
    timestamp: "timestamp without time zone",
    int: "integer",
    int4: "integer",
    int8: "bigint",
    bool: "boolean",
    varchar: "character varying",
    float8: "double precision",
  };
  return (names[base] ?? base) + (array ? "[]" : "");
}

/** The identity arguments of a CREATE FUNCTION's parameter list. */
function identityArgs(params: string): string {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts
    .map((p) => p.replace(/--[^\n]*/g, "").replace(/\s+(DEFAULT|=)\s[\s\S]*$/i, "").trim())
    .filter(Boolean)
    .map((p) => {
      const [name, ...type] = p.replace(/^IN\s+/i, "").split(/\s+/);
      return `${name} ${canonicalType(type.join(" "))}`;
    })
    .join(", ");
}

/** The newest definition of each function across the migrations, in order. */
function migratedSignatures(): Map<string, string | null> {
  const dir = join(ROOT, "supabase", "migrations");
  const latest = new Map<string, string | null>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    const events: Array<{ at: number; name: string; args: string | null }> = [];
    const create = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < sql.length && depth > 0; i++) {
        if (sql[i] === "(") depth++;
        if (sql[i] === ")") depth--;
      }
      events.push({ at: m.index, name: m[1], args: identityArgs(sql.slice(start, i - 1)) });
    }
    const drop = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.([a-z0-9_]+)\s*\(([^)]*)\)/gi;
    while ((m = drop.exec(sql))) {
      const types = m[2].split(",").map((t) => canonicalType(t)).filter(Boolean).join(", ");
      events.push({ at: m.index, name: m[1], args: `DROP ${types}` });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.args?.startsWith("DROP ")) {
        const current = latest.get(e.name);
        const currentTypes = current?.split(", ").map((a) => a.split(" ").slice(1).join(" ")).join(", ");
        if (current && currentTypes === e.args.slice(5)) latest.set(e.name, null);
      } else latest.set(e.name, e.args);
    }
  }
  return latest;
}

describe("the function contract matches the code", () => {
  it("finds the calls (the scan works)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(FUNCTION_CONTRACT.length);
    expect(findRpcCalls("x.ts", 'await db.rpc<Array<{ a: string; b: number }>>(\n  "take_code_attempt", {})')).toEqual([
      { file: "x.ts", line: 1, name: "take_code_attempt" },
    ]);
  });

  it("every .rpc() call names a function in the contract", () => {
    const listed = new Set([...FUNCTION_CONTRACT.map((f) => f.name), FUNCTION_CATALOG]);
    const unnamed = calls.filter((c) => c.name === null && !PASS_THROUGH.has(c.file));
    expect(unnamed, "an .rpc() call must name its function with a string literal").toEqual([]);
    const unlisted = calls.filter((c) => c.name !== null && !listed.has(c.name));
    expect(
      unlisted.map((c) => `${c.file}:${c.line} ${c.name}`),
      "add these to FUNCTION_CONTRACT in src/db/functionContract.ts",
    ).toEqual([]);
  });

  it("every function in the contract is called", () => {
    const called = new Set(calls.map((c) => c.name));
    expect(FUNCTION_CONTRACT.filter((f) => !called.has(f.name)).map((f) => f.name)).toEqual([]);
  });

  it("names each function once", () => {
    const names = FUNCTION_CONTRACT.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the function contract matches the migrations", () => {
  const migrated = migratedSignatures();
  it.each(FUNCTION_CONTRACT.map((f) => [f.name, f.args]))("%s", (name, args) => {
    expect(migrated.get(name), `no migration defines public.${name}(${args})`).toBe(args);
  });

  it("the catalog function itself", () => {
    expect(migrated.get(FUNCTION_CATALOG)).toBe("p_names text[]");
  });
});

describe("compareFunctions", () => {
  const contract = [{ name: "f", args: "p_a text", owner: "t" }];

  it("passes a function with exactly the contract's arguments", () => {
    expect(compareFunctions(contract, [{ name: "f", identity_args: "p_a text" }])).toEqual([]);
  });

  it("reports a missing function", () => {
    expect(compareFunctions(contract, [])).toEqual([
      expect.objectContaining({ name: "f", kind: "missing_function" }),
    ]);
  });

  it("reports other arguments (a deploy ahead of its migration)", () => {
    const [gap] = compareFunctions(contract, [{ name: "f", identity_args: "p_a text, p_b jsonb" }]);
    expect(gap.kind).toBe("mismatched_function");
    expect(gap.detail).toBe("function f has (p_a text, p_b jsonb); the code calls (p_a text)");
  });

  it("reports two versions even when one matches (PostgREST may not choose)", () => {
    const gaps = compareFunctions(contract, [
      { name: "f", identity_args: "p_a text" },
      { name: "f", identity_args: "p_a text, p_b jsonb" },
    ]);
    expect(gaps.map((g) => g.kind)).toEqual(["overloaded_function"]);
  });
});
