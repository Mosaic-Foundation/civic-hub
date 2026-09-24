import { describe, expect, it } from "vitest";
import {
  blankComments,
  checkPlaceNames,
  parseAllowlist,
} from "../../scripts/check-place-names.js";

/**
 * No string in src/ or ui/src/ may name a place — enforced.
 *
 * The same check CI runs as its own step (scripts/check-place-names.ts),
 * here so `npm test` fails on it too. It replaced a narrower test in
 * hubDocuments.test.ts that covered ui/src only, with a regex comment
 * stripper; see the scanner tests below for why that was not enough.
 */

describe("src/ and ui/src/ name no place", () => {
  it("has no place name outside comments, except the allow-listed ones", () => {
    const { offenders, errors } = checkPlaceNames();
    expect(errors).toEqual([]);
    expect(offenders.map((h) => `${h.file}:${h.line}: ${h.text}`)).toEqual([]);
  });
});

describe("the comment scanner", () => {
  const scan = (code: string, file = "x.ts") => blankComments(code, file);

  it("blanks line and block comments, keeping line numbers", () => {
    const out = scan("a; // Floyd\n/* Floyd\nFloyd */ b;");
    expect(out).not.toMatch(/Floyd/);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("b;");
  });

  it("does not mistake // inside a string for a comment", () => {
    expect(scan('const u = "https://www.floydcova.gov/x";')).toContain("floydcova");
  });

  it("does not mistake /* inside a regex for a comment", () => {
    const out = scan("const r = /a\\/*b/; const s = 'Floyd';");
    expect(out).toContain("'Floyd'");
  });

  it("scans template literals, including after an interpolation", () => {
    const out = scan("const t = `${a} in Floyd ${b} County`; // Floyd");
    expect(out).toContain("in Floyd");
    expect(out.match(/Floyd/g)).toHaveLength(1);
  });

  it("scans JSX text and blanks JSX comments", () => {
    const out = scan("const x = <p>{/* Floyd */}Floyd County</p>;", "x.tsx");
    expect(out.match(/Floyd/g)).toHaveLength(1);
  });

  it("blanks CSS comments", () => {
    expect(scan("/* Floyd */ a { color: red; }", "x.css")).not.toMatch(/Floyd/);
  });
});

describe("the allow-list", () => {
  it("requires a reason on every entry", () => {
    const { errors } = parseAllowlist("src/a.ts | Floyd |\n");
    expect(errors).toHaveLength(1);
  });

  it("fails an entry that no longer matches anything", () => {
    const { errors } = checkPlaceNames(
      undefined,
      "src/does/not/exist.ts | Floyd | kept for a reason that no longer applies\n",
    );
    expect(errors.some((e) => e.includes("no longer appears"))).toBe(true);
  });
});
