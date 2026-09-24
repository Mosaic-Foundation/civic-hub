/**
 * No string in src/ or ui/src/ may name a place.
 *
 *   npx tsx scripts/check-place-names.ts          # exit 1 on any hit
 *   npx tsx scripts/check-place-names.ts --list   # print hits, always exit 0
 *
 * The rule has been in SESSION-START.md since Phase 0: a place name is a
 * value, never code. Floyd's name, jurisdiction code, hostname, governing
 * body and URLs are hub data — a `hubs` row or a `hub_settings` key — and a
 * literal in the source is how one hub's identity ends up on another hub's
 * page. It happened four times before this check existed (the About page,
 * the tagline, the banner, the legal operator), and every time the page
 * looked plausible, which is why nobody noticed.
 *
 * WHAT IS SCANNED. Every .ts/.tsx/.js/.css file under src/ and ui/src/, with
 * comments removed first. Comments are exempt on purpose: a great many of
 * them explain *why* a value is data by describing what went wrong when it
 * was not, and that history is worth more than the word it costs. Removal
 * uses the TypeScript scanner, not a regex, so a `//` inside a URL string or
 * a `/*` inside a regex literal is not mistaken for a comment — the naive
 * version would exempt exactly the strings this check exists to catch.
 *
 * WHAT IS NOT. tests/ — test data belongs in tests/fixtures/, clearly
 * labelled, and may name anywhere it likes. scripts/ and config/hubs/ — the
 * seed script is the one reader of a hub's seed values.
 *
 * THE ALLOW-LIST. scripts/place-name-allowlist.txt, one entry per line:
 *
 *   <path> | <text that must appear on the hit line> | <reason>
 *
 * A hit is allowed only when its file matches <path> exactly and its line
 * contains <text>. The reason is required; an entry without one fails the
 * check, so the list cannot quietly grow into a list of exceptions nobody
 * can explain. An entry that no longer matches anything also fails, so it
 * cannot outlive the thing it excused.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "ui/src"];
const ALLOWLIST = resolve(ROOT, "scripts/place-name-allowlist.txt");

/**
 * The literals, matched case-insensitively. `floyd` alone covers Floyd,
 * Floyd County, floyd.civic.social, us-va-floyd, floydcova.gov and every
 * Floyd fixture id; the rest are the names that do not contain it.
 */
export const PLACE_NAME_PATTERNS: readonly RegExp[] = [
  /floyd/i,
  /board of supervisors/i,
];

export interface Hit {
  file: string; // repo-relative, forward slashes
  line: number;
  text: string; // the hit line, comments removed, trimmed
}

export interface AllowEntry {
  path: string;
  contains: string;
  reason: string;
  lineNo: number;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|css)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * The file with every comment replaced by spaces of the same shape, so line
 * numbers survive. The scanner knows strings, template literals, regex
 * literals and JSX text, which is the whole point of using it.
 */
export function blankComments(text: string, fileName: string): string {
  if (fileName.endsWith(".css")) {
    return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  }
  const variant = fileName.endsWith(".tsx") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, text);
  const chars = text.split("");
  let kind = scanner.scan();
  let prev: ts.SyntaxKind = ts.SyntaxKind.Unknown;
  // Which `{` each `}` closes: an ordinary block, or a `${` in a template.
  const braces: Array<"block" | "template"> = [];
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      for (let i = scanner.getTokenStart(); i < scanner.getTokenEnd(); i++) {
        if (chars[i] !== "\n") chars[i] = " ";
      }
    } else if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) {
      // A slash where an expression may start is a regex literal. The scanner
      // cannot know that on its own; the parser normally tells it.
      if (regexMayFollow(prev)) kind = scanner.reScanSlashToken();
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      braces.push("block");
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      // A `}` that closes a `${` resumes the template it interrupted.
      if (braces.pop() === "template") kind = scanner.reScanTemplateToken(false);
    }
    if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) {
      braces.push("template");
    }
    if (
      kind !== ts.SyntaxKind.WhitespaceTrivia &&
      kind !== ts.SyntaxKind.NewLineTrivia &&
      kind !== ts.SyntaxKind.SingleLineCommentTrivia &&
      kind !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      prev = kind;
    }
    kind = scanner.scan();
  }
  return chars.join("");
}

function regexMayFollow(prev: ts.SyntaxKind): boolean {
  switch (prev) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.CloseBraceToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateTail:
      return false;
    default:
      return true;
  }
}

/** Every place-name hit in src/ and ui/src/, comments excluded. */
export function findPlaceNameHits(root: string = ROOT): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = resolve(root, dir);
    for (const file of sourceFiles(abs)) {
      const code = blankComments(readFileSync(file, "utf-8"), file);
      const lines = code.split("\n");
      lines.forEach((text, i) => {
        if (PLACE_NAME_PATTERNS.some((p) => p.test(text))) {
          hits.push({
            file: relative(root, file).split("\\").join("/"),
            line: i + 1,
            text: text.trim(),
          });
        }
      });
    }
  }
  return hits;
}

export function parseAllowlist(text: string): { entries: AllowEntry[]; errors: string[] } {
  const entries: AllowEntry[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts.slice(2).join("|").trim()) {
      errors.push(
        `place-name-allowlist.txt:${i + 1}: expected "<path> | <text> | <reason>", ` +
          `and the reason is not optional`,
      );
      return;
    }
    entries.push({
      path: parts[0],
      contains: parts[1],
      reason: parts.slice(2).join("|").trim(),
      lineNo: i + 1,
    });
  });
  return { entries, errors };
}

export interface CheckResult {
  offenders: Hit[];
  allowed: Hit[];
  errors: string[];
}

export function checkPlaceNames(root: string = ROOT, allowlistText?: string): CheckResult {
  const text = allowlistText ?? readFileSync(resolve(root, "scripts/place-name-allowlist.txt"), "utf-8");
  const { entries, errors } = parseAllowlist(text);
  const used = new Set<AllowEntry>();
  const offenders: Hit[] = [];
  const allowed: Hit[] = [];
  for (const hit of findPlaceNameHits(root)) {
    const entry = entries.find((e) => e.path === hit.file && hit.text.includes(e.contains));
    if (entry) {
      used.add(entry);
      allowed.push(hit);
    } else {
      offenders.push(hit);
    }
  }
  for (const e of entries) {
    if (!used.has(e)) {
      errors.push(
        `place-name-allowlist.txt:${e.lineNo}: "${e.contains}" no longer appears in ${e.path} — remove the entry`,
      );
    }
  }
  return { offenders, allowed, errors };
}

function main(): void {
  const listOnly = process.argv.includes("--list");
  const { offenders, allowed, errors } = checkPlaceNames(ROOT, readFileSync(ALLOWLIST, "utf-8"));

  for (const h of offenders) console.log(`${h.file}:${h.line}: ${h.text}`);
  for (const e of errors) console.log(e);

  const ok = offenders.length === 0 && errors.length === 0;
  console.log(
    `\n${offenders.length} place name(s) in src/ and ui/src/, ` +
      `${allowed.length} allow-listed, ${errors.length} allow-list error(s).`,
  );
  if (!ok && !listOnly) {
    console.log(
      "\nA place name is a value, never code. Read it from the hub's settings " +
        "(copy.*, identity.*, email.*, legal.*) or its hubs row; move test data " +
        "to tests/fixtures/. See scripts/check-place-names.ts.",
    );
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
