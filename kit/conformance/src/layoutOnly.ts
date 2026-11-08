// Step 22's rule (Events 3, 2026-11-08; ADR-018 amendment): a package's page
// is composed of the kit's components, and its own styles set layout and
// spacing only. Step 21 holds every value to the hub's tokens; this holds
// the PROPERTIES: no colour, no type, no radius, no shadow, no border of its
// own, even in tokens, because the kit's components already wear the hub's.
// A package that wants a card uses ListCard or Card; a chip, Chip or
// StatusChip; a heading, GroupHeading or PageHead.
//
// Read: every declaration of a package's .css, and every key of an inline
// `style={{ ... }}` in its .tsx. Custom properties (`--x: ...`) are refused
// too: they are how a colour comes in by the side door.

export interface LookFinding {
  line: number;
  property: string;
}

/** The properties a package may not set (CSS names; inline styles are matched in camelCase). */
const LOOK = [
  /^color$/,
  /^background(-.*)?$/,
  /^font(-.*)?$/,
  /^line-height$/,
  /^letter-spacing$/,
  /^word-spacing$/,
  /^text-(transform|decoration.*|shadow|underline-offset|emphasis.*)$/,
  /^border(-.*)?$/,
  /^outline(-.*)?$/,
  /^box-shadow$/,
  /^fill$/,
  /^stroke(-.*)?$/,
  /^filter$/,
  /^backdrop-filter$/,
  /^opacity$/,
  /^caret-color$/,
  /^accent-color$/,
  /^--/,
];

const kebab = (camel: string) => camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function isLookProperty(property: string): boolean {
  const p = property.trim().toLowerCase();
  return LOOK.some((r) => r.test(p));
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Declarations in a stylesheet that set the look rather than the layout. */
export function scanCssLook(css: string): LookFinding[] {
  const out: LookFinding[] = [];
  // Blank comments out, keeping offsets (and so line numbers).
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
    const start = (block.index ?? 0) + 1;
    for (const decl of block[1]!.matchAll(/(^|;)\s*([-a-zA-Z]+)\s*:/g)) {
      const prop = decl[2]!;
      if (isLookProperty(prop)) out.push({ line: lineAt(text, start + (decl.index ?? 0) + decl[0].lastIndexOf(prop)), property: prop });
    }
  }
  return out;
}

/** Keys of inline `style={{ ... }}` objects that set the look. */
export function scanTsxLook(src: string): LookFinding[] {
  const out: LookFinding[] = [];
  for (const m of src.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const start = m.index ?? 0;
    for (const k of m[1]!.matchAll(/(?:^|,|\{)\s*["']?([-a-zA-Z]+)["']?\s*:/g)) {
      const prop = k[1]!.startsWith("--") ? k[1]! : kebab(k[1]!);
      if (isLookProperty(prop)) out.push({ line: lineAt(src, start + (k.index ?? 0)), property: prop });
    }
  }
  return out;
}

export function scanLook(path: string, text: string): LookFinding[] {
  if (path.endsWith(".css")) return scanCssLook(text);
  if (path.endsWith(".tsx")) return scanTsxLook(text);
  return [];
}
