import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The test runs in node from ui/; the DOM types here don't know `process`.
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const src = join(cwd, "src");
const here = join(src, "styles");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [relative(src, path)] : [];
  });
}

describe("styles/hubStyles.ts", () => {
  it("imports every stylesheet of the hub app, so none is left to load in a later order", () => {
    const imported = [...readFileSync(join(here, "hubStyles.ts"), "utf8").matchAll(/^import "([^"]+)";/gm)].map((m) =>
      relative(src, join(here, m[1]!)),
    );
    // The space type's palette colours load right after theme.css, from the
    // hosting layer's config/ (kernel step 4); the rest are the app's own.
    expect(imported[1]).toBe("../../config/spacePalette.css");
    const listed = imported.filter((f) => !f.startsWith(".."));
    const all = cssFiles(src).filter(
      // The console and the start page are other apps; the design system and
      // the token sets are @imported by theme.css.
      (f) =>
        !f.startsWith("console/") &&
        !f.startsWith("start/") &&
        !f.startsWith("styles/design-system/") &&
        !f.startsWith("styles/tokens/"),
    );
    expect([...listed].sort()).toEqual([...all].sort());
    expect(new Set(listed).size).toBe(listed.length);
    // The base first, the app's own rules next to last and the kit last, so a
    // control looks the same on every page (design pass, 2026-10-29).
    expect(listed.slice(0, 2)).toEqual(["styles/theme.css", "index.css"]);
    expect(listed.slice(-2)).toEqual(["App.css", "kit/kit.css"]);
  });
});
