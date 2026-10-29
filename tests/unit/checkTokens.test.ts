// The token rules (design pass, 2026-10-29; ADR-018 to come): what
// kit/conformance/src/tokenScan.ts counts as a colour, font or size of a
// file's own, and the per-file ratchet scripts/check-tokens.ts holds the hub
// to (scripts/lib/tokenBaseline.ts). Strings only: no files, no database.

import { describe, expect, it } from "vitest";
import { countFindings, scanCss, scanTsx, type TokenFinding } from "../../kit/conformance/src/tokenScan.js";
import { compareToBaseline, nextBaseline } from "../../scripts/lib/tokenBaseline.js";

const decl = (value: string, property = "color") => scanCss(`.a { ${property}: ${value}; }`);
const texts = (fs: TokenFinding[]) => fs.map((f) => `${f.category} ${f.text}`);

describe("colour", () => {
  it("flags every hex form", () => {
    for (const hex of ["#fff", "#ffff", "#1e3a5f", "#1e3a5f80"]) expect(texts(decl(hex))).toEqual([`colour ${hex}`]);
  });

  it("flags rgb, hsl and oklch with literal channels, and a named colour", () => {
    expect(texts(decl("rgb(0 0 0)"))).toEqual(["colour rgb(0 0 0)"]);
    expect(texts(decl("rgba(255, 255, 255, 0.5)"))).toEqual(["colour rgba(255, 255, 255, 0.5)"]);
    expect(texts(decl("hsl(210 40% 20%)"))).toEqual(["colour hsl(210 40% 20%)"]);
    expect(texts(decl("oklch(0.6 0.1 250)"))).toEqual(["colour oklch(0.6 0.1 250)"]);
    expect(texts(decl("white"))).toEqual(["colour white"]);
    expect(texts(decl("1px solid red", "border"))).toEqual(["colour red"]);
  });

  it("lets a token with an alpha through, and a color-mix of tokens", () => {
    expect(decl("rgba(var(--shadow-rgb), .5)")).toEqual([]);
    expect(decl("color-mix(in srgb, var(--color-primary) 40%, transparent)")).toEqual([]);
    expect(texts(decl("color-mix(in srgb, var(--color-primary) 40%, #fff)"))).toEqual(["colour #fff"]);
  });

  it("allows transparent, currentColor and the CSS-wide keywords", () => {
    for (const v of ["transparent", "currentColor", "inherit", "initial", "unset", "revert", "none"]) expect(decl(v)).toEqual([]);
  });

  it("does not read a name as a colour: an animation, a white-space value", () => {
    expect(decl("tan-pulse 1s", "animation")).toEqual([]);
    expect(decl("nowrap", "white-space")).toEqual([]);
  });

  it("counts a literal var() fallback", () => {
    expect(texts(decl("var(--success-color, #2e7d32)"))).toEqual(["colour #2e7d32"]);
    expect(decl("var(--a, var(--b))")).toEqual([]);
  });
});

describe("font", () => {
  it("flags a family of its own, and passes a token or inherit", () => {
    expect(texts(decl("ui-monospace, monospace", "font-family"))).toEqual(["font ui-monospace, monospace"]);
    expect(texts(decl('"Inter", sans-serif', "font-family"))).toEqual(['font "Inter", sans-serif']);
    expect(decl("var(--font-mono)", "font-family")).toEqual([]);
    expect(decl("inherit", "font-family")).toEqual([]);
    expect(decl("inherit", "font")).toEqual([]);
    expect(texts(decl("var(--font, Georgia)", "font-family"))).toEqual(["font Georgia"]);
  });
});

describe("length", () => {
  it("flags px, rem, em and pt", () => {
    expect(texts(decl("12px 1rem", "padding"))).toEqual(["length 12px", "length 1rem"]);
    expect(texts(decl("0.02em", "letter-spacing"))).toEqual(["length 0.02em"]);
    expect(texts(decl("10pt", "font-size"))).toEqual(["length 10pt"]);
  });

  it("allows 0, 1px, 2px, percentages, viewport units, fr, ch and unitless numbers", () => {
    expect(decl("0 0px 0rem", "margin")).toEqual([]);
    expect(decl("1px solid var(--border)", "border")).toEqual([]);
    expect(decl("2px", "outline-offset")).toEqual([]);
    expect(decl("-1px", "margin-top")).toEqual([]);
    expect(decl("50%", "width")).toEqual([]);
    expect(decl("100vh", "min-height")).toEqual([]);
    expect(decl("100dvh", "min-height")).toEqual([]);
    expect(decl("1fr 2fr", "grid-template-columns")).toEqual([]);
    expect(decl("60ch", "max-width")).toEqual([]);
    expect(decl("1.5", "line-height")).toEqual([]);
    expect(decl("1", "flex")).toEqual([]);
  });

  it("does not take 1rem or 1em for a hairline", () => {
    expect(texts(decl("1rem", "gap"))).toEqual(["length 1rem"]);
  });

  it("counts a literal var() fallback", () => {
    expect(texts(decl("var(--space-md, 12px)", "padding"))).toEqual(["length 12px"]);
  });
});

describe("where values are read", () => {
  it("allows a breakpoint in a @media or @container prelude, and checks the declarations inside", () => {
    const css = "@media (max-width: 640px) {\n  .a { padding: 16px; color: var(--x); }\n}\n@container (min-width: 30rem) { .b { gap: 0; } }";
    expect(scanCss(css)).toEqual([{ line: 2, category: "length", property: "padding", text: "16px" }]);
  });

  it("flags a custom property defined outside a token file", () => {
    expect(texts(scanCss(":root { --gap: 12px; --brand: #123456; --alias: var(--space-md); }"))).toEqual(["length 12px", "colour #123456"]);
  });

  it("ignores comments, strings, urls and selectors", () => {
    const css = '/* #fff 12px */ a:hover > .x[data-c="#fff"] { background: url("a#fff-12px.png"); content: "12px red"; }';
    expect(scanCss(css)).toEqual([]);
  });

  it("gives the line each finding is on", () => {
    expect(scanCss(".a {\n  color: var(--x);\n  margin: 8px;\n}").map((f) => f.line)).toEqual([3]);
  });
});

describe("tsx inline styles", () => {
  it("flags a bare number on a length property and a colour string, not a percentage", () => {
    const src = 'export const A = () => <div style={{ padding: 12, color: "#fff", width: "50%" }} />;';
    expect(scanTsx(src).map((f) => `${f.property} ${f.category} ${f.text}`)).toEqual(["padding length 12", "color colour #fff"]);
  });

  it("passes unitless properties, 0/1/2, tokens and template literals of tokens", () => {
    const src = [
      "<div style={{ lineHeight: 1.4, zIndex: 10, opacity: 0.5, flexGrow: 1, fontWeight: 600, margin: 0, borderWidth: 1 }} />",
      '<div style={{ marginTop: "var(--space-sm)", "--card-accent": `var(--type-${slug})`, width: `${pct}%` }} />',
    ].join("\n");
    expect(scanTsx(src)).toEqual([]);
  });

  it("reads strings and number branches inside an expression", () => {
    const src = '<div style={{\n  background: active ? "#fff" : "var(--x)",\n  padding: compact ? 8 : 16,\n}} />';
    expect(scanTsx(src).map((f) => `${f.line} ${f.text}`)).toEqual(["2 #fff", "3 8", "3 16"]);
  });
});

describe("the ratchet", () => {
  const c = (colour: number, font: number, length: number) => ({ colour, font, length });

  it("fails a rise in any category, and a new file with anything", () => {
    const { rises } = compareToBaseline({ "a.css": c(1, 0, 5), "b.css": c(0, 0, 1) }, { "a.css": c(2, 0, 4) });
    expect(rises).toEqual([
      { file: "a.css", category: "length", baseline: 4, now: 5 },
      { file: "b.css", category: "length", baseline: 0, now: 1 },
    ]);
  });

  it("passes a fall, and names it to lock in", () => {
    const { rises, lower } = compareToBaseline({ "a.css": c(1, 0, 4) }, { "a.css": c(2, 0, 4), "gone.css": c(0, 0, 3) });
    expect(rises).toEqual([]);
    expect(lower).toEqual(["a.css", "gone.css"]);
  });

  it("--update refuses a rise without --allow-increase, and drops files at zero", () => {
    const baseline = { "a.css": c(2, 0, 4) };
    expect(nextBaseline({ "a.css": c(3, 0, 4) }, baseline, false)).toEqual({
      baseline,
      refused: [{ file: "a.css", category: "colour", baseline: 2, now: 3 }],
    });
    expect(nextBaseline({ "a.css": c(3, 0, 4) }, baseline, true).baseline).toEqual({ "a.css": c(3, 0, 4) });
    expect(nextBaseline({ "a.css": c(0, 0, 0), "b.css": c(0, 0, 0) }, baseline, false)).toEqual({ baseline: {}, refused: [] });
  });

  it("counts by category", () => {
    expect(countFindings(scanCss(".a { color: #fff; padding: 12px 8px; font-family: serif; }"))).toEqual(c(1, 1, 2));
  });
});
