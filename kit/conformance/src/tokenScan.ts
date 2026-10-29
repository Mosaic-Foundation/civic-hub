// What a stylesheet or a page sets of its own (design pass, 2026-10-29;
// ADR-018 to come): every colour, font and size the hub draws is a CSS custom
// property defined in its token files, and a page, a kit component or a
// package uses those, never a value of its own. This finds the values that
// are not tokens, in CSS and in a .tsx file's inline `style={{ ... }}`.
//
// One implementation, used twice: the hub's per-file ratchet
// (scripts/check-tokens.ts, run by `npm run lint`) and conformance step 21,
// which holds a package to none at all. It lives here, with no dependency,
// because the conformance kit is packed and run from an empty folder.
//
// A small tokenizer, not a full CSS parser: comments, strings and url(...)
// are blanked first (offsets kept, so lines stay right), then the text is
// split into rule preludes and declarations at the top level of brackets.
// Preludes are never checked: selectors hold no values, and @media,
// @container and @supports preludes are where breakpoints live (CSS cannot
// read a custom property there). Declarations inside those blocks are.
//
// What counts as a value of its own, in a declaration:
//   colour: a hex colour; rgb()/hsl()/hwb()/lab()/lch()/oklab()/oklch()/color()
//     with two or more literal numbers left once its var()s are taken out
//     (`rgba(var(--shadow-rgb), .5)` is a token with an alpha, and passes);
//     a named colour (white, red, ...). Not transparent, currentColor or the
//     CSS-wide keywords. color-mix() itself is fine; what it mixes is checked.
//   font: a font-family, or font shorthand, that is anything but var(...) or
//     a CSS-wide keyword.
//   length: px, rem, em and pt, except 0 and 1px/2px (hairlines, borders,
//     outlines, offsets). Percentages, viewport units, fr, ch and unitless
//     numbers are not lengths of the design and pass.
// A var() fallback is checked like any value (`var(--x, 12px)` still sets
// 12px), and a custom property defined outside a token file is checked too:
// `--gap: 12px` on a page is the page defining its own token.
//
// In .tsx, only `style={{ ... }}` object literals: a string value is checked
// as a CSS value, and a bare number on a property React gives "px" is a
// length (0, 1 and 2 pass, as in CSS). A style object built elsewhere (a
// const, a function) is not seen.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type TokenCategory = "colour" | "font" | "length";
export const TOKEN_CATEGORIES: readonly TokenCategory[] = ["colour", "font", "length"];

export interface TokenFinding {
  line: number;
  category: TokenCategory;
  /** The property it was set on (kebab-case, or the custom property's name). */
  property: string;
  /** The offending text, as written. */
  text: string;
}

export type TokenCounts = Record<TokenCategory, number>;

/** Every named colour CSS knows, lower-cased (CSS Color 4). */
const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue " +
    "lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange " +
    "orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna " +
    "silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet " +
    "wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

/** Values that name no colour, font or size of their own. */
const CSS_WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/**
 * Properties whose identifiers are names, not colours (an animation called
 * "pulse", a grid area called "main"), so a named-colour word there is not one.
 */
const NAMES_NOT_COLOURS = /^(transition|transition-property|animation|animation-name|will-change|grid-template-areas|grid-area|grid-template|grid|counter-reset|counter-increment|counter-set|font-family|font|list-style-type|content|view-transition-name|container-name|container|anchor-name|position-anchor)$/;

const COLOUR_FUNCTION = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const HEX = /#([0-9a-fA-F]+)(?![\w-])/g;
const LENGTH = /(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|pt)(?![\w-])/gi;
const IDENT = /(?<![\w#.-])([a-zA-Z][a-zA-Z0-9-]*)(?![\w(-])/g;
const NUMBER = /(?<![\w#.-])[-+]?(?:\d+\.?\d*|\.\d+)(?:%|deg|grad|rad|turn)?(?![\w.-])/g;

/** Lengths that pass: zero, and the 1px and 2px of hairlines, borders and offsets. */
function lengthAllowed(n: number, unit: string): boolean {
  if (n === 0) return true;
  return unit.toLowerCase() === "px" && (Math.abs(n) === 1 || Math.abs(n) === 2);
}

// --- Helpers over text ---------------------------------------------------------

function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The index of the bracket that closes the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * CSS with comments blanked, and the inside of every string and url(...)
 * filled with "_": the same length and lines, nothing in them read as a value.
 */
function maskCss(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += blank(css.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      out += c + css.slice(i + 1, j).replace(/[^\n]/g, "_") + (j < css.length ? css[j] : "");
      i = j + 1;
    } else if (/^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(css[i - 1] ?? "")) {
      const end = closing(css, i + 3);
      const stop = end === -1 ? css.length : end;
      out += css.slice(i, i + 4) + css.slice(i + 4, stop).replace(/[^\n]/g, "_");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// --- One value -------------------------------------------------------------------

/**
 * Check one declaration's value. `masked` is the value with strings and urls
 * filled; `original` the same span as written; `at` its offset in the file.
 */
function scanValue(property: string, masked: string, original: string, at: number, push: (f: Omit<TokenFinding, "line"> & { at: number }) => void): void {
  // Take every var() out (blanked, same length), checking its fallback as a
  // value of its own: a literal fallback is still a literal.
  let work = masked;
  const varCall = /(?<![\w-])var\(/gi;
  for (let m = varCall.exec(work); m; m = varCall.exec(work)) {
    const open = m.index + 3;
    const end = closing(work, open);
    if (end === -1) break;
    const inner = work.slice(open + 1, end);
    let depth = 0;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === "(") depth++;
      else if (inner[k] === ")") depth--;
      else if (inner[k] === "," && depth === 0) {
        const from = open + 1 + k + 1;
        scanValue(property, work.slice(from, end), original.slice(from, end), at + from, push);
        break;
      }
    }
    work = work.slice(0, m.index) + blank(work.slice(m.index, end + 1)) + work.slice(end + 1);
    varCall.lastIndex = end + 1;
  }
  work = work.replace(/!\s*important\s*$/i, (s) => blank(s));

  // Font: the family is a token or nothing of its own.
  if (property === "font-family" || property === "font") {
    const rest = work.trim();
    if (rest && !CSS_WIDE.has(rest.toLowerCase())) {
      const lead = work.length - work.trimStart().length;
      push({ category: "font", property, text: original.trim(), at: at + lead });
    }
  }

  // Colour: hex.
  for (const m of work.matchAll(HEX)) {
    if ([3, 4, 6, 8].includes(m[1]!.length)) push({ category: "colour", property, text: original.slice(m.index, m.index + m[0].length), at: at + m.index });
  }
  // Colour: a colour function with its channels written out.
  for (const m of work.matchAll(COLOUR_FUNCTION)) {
    const open = m.index + m[0].length - 1;
    const end = closing(work, open);
    if (end === -1) continue;
    const numbers = work.slice(open + 1, end).match(NUMBER) ?? [];
    if (numbers.length >= 2) push({ category: "colour", property, text: original.slice(m.index, end + 1), at: at + m.index });
  }
  // Colour: a named colour.
  if (!NAMES_NOT_COLOURS.test(property)) {
    for (const m of work.matchAll(IDENT)) {
      if (NAMED_COLOURS.has(m[1]!.toLowerCase())) push({ category: "colour", property, text: original.slice(m.index, m.index + m[0].length), at: at + m.index });
    }
  }

  // Length.
  for (const m of work.matchAll(LENGTH)) {
    if (!lengthAllowed(Number(m[1]), m[2]!)) push({ category: "length", property, text: original.slice(m.index, m.index + m[0].length), at: at + m.index });
  }
}

function withLines(text: string, raw: Array<Omit<TokenFinding, "line"> & { at: number }>): TokenFinding[] {
  const lineOf = lineIndex(text);
  return raw
    .sort((a, b) => a.at - b.at)
    .map(({ at, ...f }) => ({ line: lineOf(at), ...f }));
}

// --- CSS ---------------------------------------------------------------------------

/** Every value of its own in a stylesheet. */
export function scanCss(css: string): TokenFinding[] {
  const masked = maskCss(css);
  const raw: Array<Omit<TokenFinding, "line"> & { at: number }> = [];
  const push = (f: (typeof raw)[number]) => raw.push(f);
  let blocks = 0;
  let parens = 0;
  let start = 0;

  const declaration = (from: number, to: number) => {
    if (blocks === 0) return; // a statement at the top (@import, @charset, @layer a, b)
    const seg = masked.slice(from, to);
    if (seg.trimStart().startsWith("@")) return;
    const colon = seg.indexOf(":");
    if (colon === -1) return;
    const property = seg.slice(0, colon).trim();
    if (!/^(--[\w-]+|-?[a-zA-Z][a-zA-Z-]*)$/.test(property)) return;
    const name = property.startsWith("--") ? property : property.toLowerCase();
    const vFrom = from + colon + 1;
    scanValue(name, masked.slice(vFrom, to), css.slice(vFrom, to), vFrom, push);
  };

  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") parens++;
    else if (c === ")") parens = Math.max(0, parens - 1);
    if (parens > 0) continue;
    if (c === "{") {
      blocks++; // the prelude (a selector, @media ...) is not a value
      start = i + 1;
    } else if (c === ";") {
      declaration(start, i);
      start = i + 1;
    } else if (c === "}") {
      declaration(start, i);
      blocks = Math.max(0, blocks - 1);
      start = i + 1;
    }
  }
  return withLines(css, raw);
}

// --- TSX inline styles ---------------------------------------------------------------

/**
 * React's unitless properties (react-dom's isUnitlessNumber): a bare number
 * on one of these is a number, on anything else it is pixels.
 */
const UNITLESS = new Set(
  (
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup " +
    "boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow " +
    "gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp " +
    "lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity " +
    "strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth"
  ).split(" "),
);

/** Is a bare number on this key a number (not pixels)? Custom properties and vendor-prefixed unitless ones too. */
function unitless(key: string): boolean {
  if (key.startsWith("--")) return true;
  const plain = key.replace(/^(Webkit|Moz|ms|O)([A-Z])/, (_, _p, c: string) => c.toLowerCase());
  return UNITLESS.has(plain);
}

function kebab(key: string): string {
  if (key.startsWith("--")) return key;
  const k = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return /^(webkit|moz|ms|o)-/.test(k) ? `-${k}` : k;
}

/**
 * The end of the JS string, template or comment starting at `i`, or -1 if
 * none starts there. A template's ${...} is skipped over whole.
 */
function skipJs(src: string, i: number): number {
  const c = src[i];
  if (c === "/" && src[i + 1] === "/") {
    const e = src.indexOf("\n", i);
    return e === -1 ? src.length : e;
  }
  if (c === "/" && src[i + 1] === "*") {
    const e = src.indexOf("*/", i + 2);
    return e === -1 ? src.length : e + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") j += 2;
      else if (src[j] === "$" && src[j + 1] === "{") j = jsClosing(src, j + 1) + 1;
      else j++;
    }
    return j + 1;
  }
  return -1;
}

/** The index of the brace/bracket closing the one at `open`, skipping strings and comments. */
function jsClosing(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const skip = skipJs(src, i);
    if (skip !== -1) {
      i = skip - 1;
      continue;
    }
    const c = src[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if ((c === "}" || c === ")" || c === "]") && --depth === 0) return i;
  }
  return src.length;
}

/** The top-level `key: value` entries of the object literal whose braces are at open..close. */
function objectEntries(src: string, open: number, close: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const skip = skipJs(src, i);
    if (skip !== -1) {
      i = skip - 1;
      continue;
    }
    const c = src[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push({ from: start, to: i });
      start = i + 1;
    }
  }
  if (src.slice(start, close).trim()) out.push({ from: start, to: close });
  return out;
}

/** The string and template literals in an expression: their contents' spans, ${...} blanked. */
function literalsIn(src: string, from: number, to: number): Array<{ at: number; masked: string; original: string }> {
  const out: Array<{ at: number; masked: string; original: string }> = [];
  for (let i = from; i < to; i++) {
    const end = skipJs(src, i);
    if (end === -1) continue;
    const q = src[i];
    if (q === '"' || q === "'" || q === "`") {
      const original = src.slice(i + 1, end - 1);
      let masked = original;
      if (q === "`") {
        masked = "";
        for (let k = 0; k < original.length; k++) {
          if (original[k] === "$" && original[k + 1] === "{") {
            const e = jsClosing(original, k + 1);
            masked += blank(original.slice(k, e + 1));
            k = e;
          } else masked += original[k];
        }
      }
      out.push({ at: i + 1, masked: maskCss(masked), original });
    }
    i = end - 1;
  }
  return out;
}

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)$/;
/** A number that is a whole branch of a ternary or a ?? / || default: `compact ? 8 : 16`. */
const BRANCH_NUMBER = /(?:\?\?|\|\||\?|:)\s*(-?(?:\d+\.?\d*|\.\d+))\s*(?=:|$)/g;

/** Every value of its own in a .tsx file's `style={{ ... }}` literals. */
export function scanTsx(src: string): TokenFinding[] {
  const raw: Array<Omit<TokenFinding, "line"> & { at: number }> = [];
  const push = (f: (typeof raw)[number]) => raw.push(f);
  for (const m of src.matchAll(/\bstyle=\{\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = jsClosing(src, open);
    for (const { from, to } of objectEntries(src, open, close)) {
      const entry = src.slice(from, to);
      if (entry.trim().startsWith("...")) continue;
      // The key's colon: the first at the top, outside a quoted key.
      let colon = -1;
      for (let i = 0; i < entry.length; i++) {
        const skip = skipJs(entry, i);
        if (skip !== -1) {
          i = skip - 1;
          continue;
        }
        if (entry[i] === ":") {
          colon = i;
          break;
        }
      }
      if (colon === -1) continue; // shorthand `{ color }`: a variable
      const key = entry.slice(0, colon).trim().replace(/^["'`]|["'`]$/g, "");
      if (key.startsWith("[")) continue; // a computed key
      const property = kebab(key);
      const vFrom = from + colon + 1;
      const value = src.slice(vFrom, to);
      const trimmed = value.trim();
      const lead = value.length - value.trimStart().length;

      if (NUMERIC.test(trimmed)) {
        if (!unitless(key) && !lengthAllowed(Number(trimmed), "px")) {
          push({ category: "length", property, text: trimmed, at: vFrom + lead });
        }
        continue;
      }
      for (const lit of literalsIn(src, vFrom, to)) scanValue(property, lit.masked, lit.original, lit.at, push);
      if (!unitless(key)) {
        for (const b of trimmed.matchAll(BRANCH_NUMBER)) {
          if (!lengthAllowed(Number(b[1]), "px")) push({ category: "length", property, text: b[1]!, at: vFrom + lead + b.index + b[0].indexOf(b[1]!) });
        }
      }
    }
  }
  return withLines(src, raw);
}

// --- Files -----------------------------------------------------------------------------

/** A .css or .tsx file's findings; anything else has none. */
export function scanSource(path: string, text: string): TokenFinding[] {
  if (path.endsWith(".css")) return scanCss(text);
  if (path.endsWith(".tsx")) return scanTsx(text);
  return [];
}

export function countFindings(findings: readonly TokenFinding[]): TokenCounts {
  const counts: TokenCounts = { colour: 0, font: 0, length: 0 };
  for (const f of findings) counts[f.category]++;
  return counts;
}

/** Folders never scanned: dependencies, builds and tests. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "test", "tests", "__tests__", "test-results"]);

/** Every .css and .tsx file under `dir` (absolute paths, sorted), tests and builds left out. */
export function scannableFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(css|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(abs);
    }
  };
  walk(dir);
  return out.sort();
}

/** Every finding in a folder, by file (absolute path); files with none left out. */
export function scanDir(dir: string): Map<string, TokenFinding[]> {
  const out = new Map<string, TokenFinding[]>();
  for (const file of scannableFiles(dir)) {
    const findings = scanSource(file, readFileSync(file, "utf8"));
    if (findings.length) out.set(file, findings);
  }
  return out;
}
