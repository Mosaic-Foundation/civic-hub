/**
 * The token check (design pass, 2026-10-29; ADR-018 to come): every colour,
 * font and size the hub draws is a CSS custom property defined in a token
 * file, and no page, kit component or package sets one of its own. The tree
 * is not there yet, so this is a ratchet: config/token-baseline.json holds
 * each file's counts, and a file may only go down.
 *
 *   npx tsx scripts/check-tokens.ts                     # the check (npm run lint, CI): exit 1 on any rise
 *   npx tsx scripts/check-tokens.ts --update            # lock in what went down (refuses a rise)
 *   npx tsx scripts/check-tokens.ts --update --allow-increase   # ...and a rise, deliberately
 *   npx tsx scripts/check-tokens.ts --report            # totals, and the 20 worst files
 *   npx tsx scripts/check-tokens.ts --file <path>       # every finding in one file, to clean it up
 *
 * What counts (and what does not) is kit/conformance/src/tokenScan.ts, the
 * one implementation; conformance step 21 runs it on a package with no
 * baseline at all. The counts are per category, so a rise in one category is
 * not hidden by a fall in another. A rise prints every finding of that
 * category in the file (the baseline holds counts, not lines, so which one is
 * new is for the reader). `npm run tokens:check`, `npm run tokens:update`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { countFindings, scanSource, scannableFiles, TOKEN_CATEGORIES, type TokenFinding } from "../kit/conformance/src/tokenScan.js";
import { compareToBaseline, nextBaseline, type TokenBaseline } from "./lib/tokenBaseline.js";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE = join(ROOT, "config/token-baseline.json");

/** Where values live: the token files. Exempt from the check, file by file or by folder (a trailing "/"). */
export const TOKEN_DEFINITION_FILES: readonly string[] = [
  "ui/src/styles/theme.css",
  "ui/src/styles/design-system/tokens.css",
  "ui/src/styles/tokens/",
];

/** What is scanned: the hub's UI, the features' UI folders, and every package. */
function scannedFiles(): string[] {
  const files = [
    ...scannableFiles(join(ROOT, "ui/src")),
    ...scannableFiles(join(ROOT, "features")).filter((f) => /^features\/[^/]+\/(.+\/)?ui\//.test(rel(f))),
    ...scannableFiles(join(ROOT, "packages")),
  ];
  return files.filter((f) => !exempt(rel(f)));
}

const rel = (abs: string) => relative(ROOT, abs).split(sep).join("/");
const exempt = (file: string) => TOKEN_DEFINITION_FILES.some((e) => (e.endsWith("/") ? file.startsWith(e) : file === e));

function scanAll(): Map<string, TokenFinding[]> {
  const out = new Map<string, TokenFinding[]>();
  for (const abs of scannedFiles()) {
    const findings = scanSource(abs, readFileSync(abs, "utf8"));
    if (findings.length) out.set(rel(abs), findings);
  }
  return out;
}

function countsOf(found: Map<string, TokenFinding[]>): TokenBaseline {
  const out: TokenBaseline = {};
  for (const [file, findings] of found) out[file] = countFindings(findings);
  return out;
}

function readBaseline(): TokenBaseline {
  return existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as TokenBaseline) : {};
}

const show = (file: string, f: TokenFinding) => `  ${file}:${f.line}  ${f.category.padEnd(6)}  ${f.property}: ${f.text}`;

function main(): number {
  const args = process.argv.slice(2);

  const fileAt = args.indexOf("--file");
  if (fileAt !== -1) {
    const target = args[fileAt + 1];
    if (!target) {
      console.error("--file needs a path");
      return 1;
    }
    const abs = resolve(process.cwd(), target);
    if (!existsSync(abs)) {
      console.error(`No such file: ${target}`);
      return 1;
    }
    const file = rel(abs);
    const findings = scanSource(abs, readFileSync(abs, "utf8"));
    for (const f of findings) console.log(show(file, f));
    const c = countFindings(findings);
    console.log(`${file}: ${findings.length} (colour ${c.colour}, font ${c.font}, length ${c.length})${exempt(file) ? " — a token file, exempt from the check" : ""}`);
    return 0;
  }

  const found = scanAll();
  const current = countsOf(found);
  const baseline = readBaseline();

  if (args.includes("--report")) {
    const totals = { colour: 0, font: 0, length: 0 };
    for (const c of Object.values(current)) for (const k of TOKEN_CATEGORIES) totals[k] += c[k];
    console.log(`Values of their own, ${Object.keys(current).length} files: colour ${totals.colour}, font ${totals.font}, length ${totals.length} (total ${totals.colour + totals.font + totals.length})`);
    console.log("\nThe 20 worst files:");
    const worst = Object.entries(current)
      .map(([file, c]) => ({ file, c, n: c.colour + c.font + c.length }))
      .sort((a, b) => b.n - a.n || a.file.localeCompare(b.file))
      .slice(0, 20);
    for (const { file, c, n } of worst) console.log(`  ${String(n).padStart(5)}  ${file}  (colour ${c.colour}, font ${c.font}, length ${c.length})`);
    return 0;
  }

  if (args.includes("--update")) {
    const { baseline: next, refused } = nextBaseline(current, baseline, args.includes("--allow-increase"));
    if (refused.length) {
      console.error("Refused: these would raise the baseline (pass --allow-increase as well to mean it):");
      for (const r of refused) console.error(`  ${r.file}  ${r.category} ${r.baseline} -> ${r.now}`);
      return 1;
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Wrote config/token-baseline.json: ${Object.keys(next).length} files.`);
    return 0;
  }

  const { rises, lower } = compareToBaseline(current, baseline);
  for (const file of lower) console.log(`${file}: lower than baseline; run --update to lock it in`);
  if (rises.length === 0) {
    console.log(`Tokens: no file above its baseline (${Object.keys(current).length} files still have values of their own).`);
    return 0;
  }
  console.error("\nTokens: a colour, font or size of its own, where a token belongs (kit/conformance/src/tokenScan.ts says what counts):");
  for (const r of rises) {
    console.error(`\n${r.file}: ${r.category} ${r.now}, baseline ${r.baseline}${r.baseline === 0 && !baseline[r.file] ? " (not in the baseline: a new file starts at none)" : ""}`);
    for (const f of found.get(r.file) ?? []) if (f.category === r.category) console.error(show(r.file, f));
  }
  console.error("\nUse a token (ui/src/styles/theme.css, ui/src/styles/design-system/tokens.css) instead. `--file <path>` lists one file's findings.");
  return 1;
}

process.exit(main());
