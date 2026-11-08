// Conformance step 22 (Events 3): what kit/conformance/src/layoutOnly.ts
// counts as a package setting the look rather than the layout.

import { describe, expect, it } from "vitest";
import { scanCssLook, scanTsxLook } from "../../kit/conformance/src/layoutOnly.js";

describe("step 22: layout and spacing only", () => {
  it("lets layout and spacing through", () => {
    const css = `.a { display: grid; gap: var(--space-2); margin: 0 auto; padding-inline: var(--space-4); }
@media (max-width: 767px) { .a { grid-template-columns: 1fr; order: 2; } }`;
    expect(scanCssLook(css)).toEqual([]);
  });

  it("refuses colour, type, radius, shadow, border and custom properties, tokens or not", () => {
    const css = `/* color: red */
.a {
  color: var(--color-text);
  font-size: var(--text-small-size);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  border-top: var(--border-width) solid var(--color-border);
  --card-accent: var(--type-event-fg);
  gap: var(--space-2);
}`;
    expect(scanCssLook(css).map((f) => `${f.line} ${f.property}`)).toEqual([
      "3 color",
      "4 font-size",
      "5 border-radius",
      "6 box-shadow",
      "7 border-top",
      "8 --card-accent",
    ]);
  });

  it("reads inline styles in camelCase", () => {
    const tsx = `<div style={{ marginTop: 0, backgroundColor: "var(--x)", "--card-accent": "var(--y)" }} />`;
    expect(scanTsxLook(tsx).map((f) => f.property)).toEqual(["background-color", "--card-accent"]);
  });
});
