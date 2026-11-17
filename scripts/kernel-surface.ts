// The kernel surface inventory (docs/kernel/SURFACE.md): every name a package
// in packages/ imports from the hub's SDK version 0
// (@civic-social/plugin-sdk/first-party) that version 1 (kit/sdk/index.ts)
// does not offer, with the engine module it comes from and the packages that
// use it, and the paths each package still imports from src/ or ui/src/. Step 1
// of the kernel extraction ends when this prints nothing.
//
//   npx tsx scripts/kernel-surface.ts          the table
//   npx tsx scripts/kernel-surface.ts --count  one line per package

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** The names an `export { … }` / `import { … }` list carries (the exported name for `a as b`). */
function names(list: string, exported: boolean): string[] {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((s) => {
      const m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(s);
      return m ? (exported ? (m[2] ?? m[1]) : m[1]) : "";
    })
    .filter(Boolean);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((d) => {
    const p = join(dir, d);
    if (statSync(p).isDirectory()) return d === "node_modules" ? [] : files(p);
    return /\.tsx?$/.test(d) && !/\.test\.tsx?$/.test(d) ? [p] : [];
  });
}

const v0 = readFileSync(join(ROOT, "src/sdk/index.ts"), "utf8");
const source = new Map<string, string>();
for (const m of v0.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/gs)) {
  for (const n of names(m[1], true)) source.set(n, m[2].replace(/^\.\.\//, "src/"));
}
const v1 = new Set<string>();
for (const m of readFileSync(join(ROOT, "kit/sdk/index.ts"), "utf8").matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gs)) {
  for (const n of names(m[1], true)) v1.add(n);
}

const used = new Map<string, Set<string>>();
const perPackage = new Map<string, number>();
/** Imports by path that leave the package (into src/ or ui/src/), by package. */
const reaches = new Map<string, Set<string>>();
for (const dir of readdirSync(join(ROOT, "packages")).sort()) {
  const pkg = dir.replace(/^civic\./, "");
  const own = new Set<string>();
  for (const f of files(join(ROOT, "packages", dir))) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/from\s+["'](\.\.\/\.\.\/[^"']+)["']/g)) {
      const target = relative(ROOT, join(f, "..", m[1]));
      if (target.startsWith("packages/")) continue;
      if (!reaches.has(pkg)) reaches.set(pkg, new Set());
      reaches.get(pkg)!.add(target.replace(/\.(js|tsx?)$/, ""));
    }
    for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@civic-social\/plugin-sdk\/first-party["']/gs)) {
      for (const n of names(m[1], false)) {
        if (v1.has(n)) continue;
        own.add(n);
        if (!used.has(n)) used.set(n, new Set());
        used.get(n)!.add(pkg);
      }
    }
  }
  perPackage.set(pkg, own.size);
}

if (process.argv.includes("--count")) {
  for (const [pkg, n] of perPackage) console.log(`${pkg.padEnd(22)} ${String(n).padStart(3)} names, ${String(reaches.get(pkg)?.size ?? 0).padStart(3)} paths into the hub`);
  console.log(`${"total names".padEnd(22)} ${used.size}`);
} else {
  const rows = [...used].sort(([a], [b]) => (source.get(a) ?? "").localeCompare(source.get(b) ?? "") || a.localeCompare(b));
  for (const [n, pkgs] of rows) console.log(`${n.padEnd(30)} ${(source.get(n) ?? "?").padEnd(48)} ${[...pkgs].sort().join(",")}`);
  console.log(`\n${used.size} names; ${relative(ROOT, join(ROOT, "docs/kernel/SURFACE.md"))} decides each.`);
  const paths = [...reaches].sort(([a], [b]) => a.localeCompare(b));
  if (paths.length) console.log(`\nPaths into the hub (pages and shared files still to move):`);
  for (const [pkg, ps] of paths) console.log(`${pkg.padEnd(22)} ${[...ps].sort().join(", ")}`);
}
