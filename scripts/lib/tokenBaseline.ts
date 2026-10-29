// The token ratchet (design pass, 2026-10-29): config/token-baseline.json
// holds, per file, how many values of its own (colour, font, length) it set
// when the token system came in. A file may only go down. The scanning
// itself is kit/conformance/src/tokenScan.ts; this is the bookkeeping, kept
// apart so tests/unit/checkTokens.test.ts can try it on plain objects.

import { TOKEN_CATEGORIES, type TokenCategory, type TokenCounts } from "../../kit/conformance/src/tokenScan.js";

/** File path (from the hub's root, forward slashes) to its counts. */
export type TokenBaseline = Record<string, TokenCounts>;

export interface TokenRise {
  file: string;
  category: TokenCategory;
  baseline: number;
  now: number;
}

const ZERO: TokenCounts = { colour: 0, font: 0, length: 0 };
const total = (c: TokenCounts) => c.colour + c.font + c.length;

/**
 * The current counts held to the baseline: `rises` are what fails the check
 * (a category above its baseline, or a file the baseline does not list with
 * anything at all); `lower` are files now below it, to be locked in with
 * --update. A file the baseline lists that is gone, or clean, is lower.
 */
export function compareToBaseline(current: TokenBaseline, baseline: TokenBaseline): { rises: TokenRise[]; lower: string[] } {
  const rises: TokenRise[] = [];
  const lower: string[] = [];
  for (const file of [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort()) {
    const now = current[file] ?? ZERO;
    const was = baseline[file] ?? ZERO;
    let fell = false;
    for (const category of TOKEN_CATEGORIES) {
      if (now[category] > was[category]) rises.push({ file, category, baseline: was[category], now: now[category] });
      else if (now[category] < was[category]) fell = true;
    }
    if (fell) lower.push(file);
  }
  return { rises, lower };
}

/**
 * The baseline --update writes: the current counts, files at zero dropped,
 * keys sorted. Any rise is `refused` unless `allowIncrease`, and then the
 * baseline is returned unchanged.
 */
export function nextBaseline(current: TokenBaseline, baseline: TokenBaseline, allowIncrease: boolean): { baseline: TokenBaseline; refused: TokenRise[] } {
  const { rises } = compareToBaseline(current, baseline);
  if (rises.length && !allowIncrease) return { baseline, refused: rises };
  const next: TokenBaseline = {};
  for (const file of Object.keys(current).sort()) {
    if (total(current[file]!) > 0) next[file] = { ...current[file]! };
  }
  return { baseline: next, refused: [] };
}
