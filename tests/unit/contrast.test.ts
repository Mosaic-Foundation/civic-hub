// Every text and background pair the hub's token sets name meets WCAG AA
// (design pass, 2026-10-29; ADR-018). Read from the stylesheets themselves:
// the palette (design-system/tokens.css), the roles (theme.css) and each look
// or mode over them, each custom property resolved through its var() chain.
// A theme an admin picks is derived and adjusted to these ratios by
// src/shared/theme.ts (its own tests); this holds the defaults to them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "../../src/shared/theme";

const STYLES = new URL("../../ui/src/styles/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, STYLES), "utf8");

type Vars = Map<string, string>;

/** The custom properties declared in every rule whose selector list matches `select`. */
function declarations(css: string, select: (selector: string) => boolean): Vars {
  const out: Vars = new Map();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // The selector list follows any @import lines before it.
    const selectors = m[1]!.split(";").pop()!.split(",").map((s) => s.trim());
    if (!selectors.some(select)) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1]!, d[2]!.trim());
  }
  return out;
}

const palette = declarations(read("design-system/tokens.css"), (s) => s === ":root");
const roles = declarations(read("theme.css"), (s) => s === ":root");

/** A token set: the palette, the roles, then a look's or mode's overrides, later winning. */
function tokenSet(...layers: Vars[]): Vars {
  const all: Vars = new Map();
  for (const layer of [palette, roles, ...layers]) for (const [k, v] of layer) all.set(k, v);
  return all;
}

function resolve(vars: Vars, value: string, depth = 0): string {
  if (depth > 20) throw new Error(`var() chain too deep: ${value}`);
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => {
    const v = vars.get(name) ?? fallback;
    if (v === undefined) throw new Error(`${name} is not defined`);
    return resolve(vars, v, depth + 1);
  });
}

/** A token as a hex colour; `transparent` reads as the surface it sits on. */
function colour(vars: Vars, token: string, under = "--color-surface"): string {
  const v = resolve(vars, `var(${token})`).trim().toLowerCase();
  if (v === "transparent") return colour(vars, under);
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!hex) throw new Error(`${token} is not a plain colour: ${v}`);
  const h = hex[1]!;
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

const TEXT = 4.5;
const UI = 3;

/** [foreground, background, minimum]: words, then edges that find a control. */
const PAIRS: Array<[string, string, number]> = [
  ...["--color-text", "--color-text-strong", "--color-text-muted", "--color-text-subtle", "--color-link"].flatMap(
    (fg) =>
      ["--color-bg", "--color-surface", "--color-surface-sunken", "--color-surface-hover", "--color-surface-stripe", "--table-row-hover"].map(
        (bg) => [fg, bg, TEXT] as [string, string, number],
      ),
  ),
  ["--color-primary-text", "--color-primary", TEXT],
  ["--color-primary-text", "--color-primary-hover", TEXT],
  ["--color-primary-ink", "--color-primary-wash", TEXT],
  ["--color-primary-ink", "--color-primary-tint", TEXT],
  ["--color-accent-text", "--color-accent", TEXT],
  ["--color-accent-text", "--color-accent-hover", TEXT],
  ["--color-accent-ink", "--color-accent-wash", TEXT],
  ["--color-accent-ink", "--color-surface", TEXT],
  ["--color-admin-bar-text", "--color-admin-bar-bg", TEXT],
  ["--color-admin-bar-text-active", "--color-admin-bar-bg", TEXT],
  ["--color-admin-bar-title", "--color-admin-bar-bg", TEXT],
  ["--color-badge-text", "--color-badge-bg", TEXT],
  ["--color-success", "--color-success-bg", TEXT],
  ["--color-error", "--color-error-bg", TEXT],
  ["--color-error", "--color-surface", TEXT],
  ["--color-warning", "--color-warning-bg", TEXT],
  ["--table-head-text", "--table-head-bg", TEXT],
  ["--color-border-control", "--color-surface", UI],
  ["--color-focus", "--color-surface", UI],
  ["--color-primary", "--color-surface", UI],
  ...["vote", "proposal", "conversation", "project", "wordcloud", "announcement", "meeting", "brief", "generic"].flatMap(
    (t) =>
      [
        [`--type-${t}-fg`, `--type-${t}-bg`, TEXT],
        [`--type-${t}-fg`, "--color-surface", TEXT],
      ] as Array<[string, string, number]>,
  ),
];

// The hub's look (Daylight, Adam's choice, 2026-10-29); the dark set joins
// it with decision 9.
const SETS: Record<string, Vars> = {
  light: tokenSet(),
};

describe("token contrast (WCAG AA)", () => {
  for (const [name, vars] of Object.entries(SETS)) {
    describe(name, () => {
      it.each(PAIRS)("%s on %s ≥ %s", (fg, bg, min) => {
        const ratio = contrast(colour(vars, fg, bg), colour(vars, bg));
        expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      });
    });
  }

  it("every look's colour tokens resolve", () => {
    for (const vars of Object.values(SETS)) {
      for (const [fg, bg] of PAIRS) {
        expect(() => colour(vars, fg, bg)).not.toThrow();
        expect(() => colour(vars, bg)).not.toThrow();
      }
    }
  });
});
