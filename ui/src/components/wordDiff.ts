/**
 * Word-level diff for the edit history: the smallest description of how
 * one text became another, as runs of kept / removed / added words.
 * Longest-common-subsequence on whitespace-delimited tokens (newlines kept
 * as tokens so paragraph breaks survive). Inputs are stripped Markdown, so
 * a description diff reads as prose, not markers. Sizes here are a few
 * hundred words, so the O(n·m) table is fine.
 */
export type DiffRun = { kind: "same" | "removed" | "added"; text: string };

function tokenize(text: string): string[] {
  return text.split(/(\n+|\s+)/).filter((t) => t.length > 0);
}

export function wordDiff(before: string, after: string): DiffRun[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const runs: DiffRun[] = [];
  const push = (kind: DiffRun["kind"], text: string) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += text;
    else runs.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push("removed", a[i]); i++; }
    else { push("added", b[j]); j++; }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return runs;
}

/** True when the change is small enough that a diff reads better than blocks. */
export function changedShare(runs: DiffRun[]): number {
  let changed = 0;
  let total = 0;
  for (const r of runs) {
    total += r.text.length;
    if (r.kind !== "same") changed += r.text.length;
  }
  return total === 0 ? 0 : changed / total;
}
