// Text on a primary fill is --color-primary-text, never --color-primary-ink
// (engine 2, A7). The second is the darkest primary tone, for text on a light
// tint; reading it as the first drew black text on the dark-blue Submit of
// the Events form and on the Activity page's chosen chip (Adam's walk,
// 2026-10-27). Every stylesheet the hub or a package ships is held to it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

describe("text on a primary fill", () => {
  it("is never --color-primary-ink, in any rule that fills with --color-primary", () => {
    const offenders: string[] = [];
    for (const file of ["ui/src", "packages", "features"].flatMap((d) => cssFiles(join(ROOT, d)))) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2];
        if (/background(-color)?\s*:\s*var\(--color-primary\)/.test(body) && /(^|;|\s)color\s*:\s*var\(--color-primary-ink/.test(body)) {
          offenders.push(`${relative(ROOT, file)}: ${m[1].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
