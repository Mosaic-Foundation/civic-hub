// The kit stands alone (Events 3, 2026-11-08; ADR-018 amendment): the UI kit
// (ui/src/kit) and the tokens (ui/src/styles/theme.css and what it imports)
// reach nothing of the hub's, so another Mosaic space can take them as they
// are. And the SDK's UI entry (kit/sdk/ui.ts) reaches the hub only for the
// host-provided pieces named here, never its pages or its server.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (abs: string) => relative(ROOT, abs);

/** Local imports a file makes at run time (type-only imports leave nothing behind) and its CSS @imports. */
function localImports(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/(import|export) type [^;]*;/g, "");
  const specs = [
    ...text.matchAll(/(?:import|export)[^'"]*?from\s+["']([^"']+)["']/g),
    ...text.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g),
  ].map((m) => m[1]!);
  const out: string[] = [];
  for (const spec of specs) {
    if (!spec.startsWith(".")) continue;
    const base = normalize(join(dirname(file), spec));
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base.replace(/\.js$/, ".ts")].find(
      (c) => existsSync(c) && !readdirSafe(c),
    );
    if (hit) out.push(hit);
  }
  return out;
}

function readdirSafe(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

function closure(starts: string[]): Set<string> {
  const seen = new Set<string>();
  const todo = [...starts];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...localImports(f));
  }
  return seen;
}

const KIT = join(ROOT, "ui/src/kit");
const STYLES = join(ROOT, "ui/src/styles");

/**
 * What the SDK's UI entry takes from the hub rather than the kit, by name:
 * the drafting shell (it knows the hub's sign-in, assistant and header) and
 * the type of a package's UI module (types only).
 */
const HOST_PROVIDED = new Set(["ui/src/components/DraftShell.tsx"]);

describe("the kit and the tokens stand alone", () => {
  it("ui/src/kit reaches only itself and the tokens", () => {
    const starts = readdirSync(KIT)
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f))
      .map((f) => join(KIT, f));
    const outside = [...closure(starts)].filter((f) => !f.startsWith(KIT + "/") && !f.startsWith(STYLES + "/")).map(rel);
    expect(outside).toEqual([]);
  });

  it("the tokens reach only themselves", () => {
    const outside = [...closure([join(STYLES, "theme.css")])].filter((f) => !f.startsWith(STYLES + "/")).map(rel);
    expect(outside).toEqual([]);
  });

  it("kit/sdk/ui.ts takes the kit, and from the hub only what HOST_PROVIDED names; never a page or the server", () => {
    const direct = localImports(join(ROOT, "kit/sdk/ui.ts")).map(rel);
    const fromHub = direct.filter((f) => !f.startsWith("ui/src/kit/"));
    expect(fromHub.filter((f) => !HOST_PROVIDED.has(f))).toEqual([]);
    expect(direct.filter((f) => f.startsWith("ui/src/pages/") || f.startsWith("src/"))).toEqual([]);
  });
});
