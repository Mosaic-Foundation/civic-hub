/**
 * A conversation draft's seed statements as they go to Polis: one per line,
 * trimmed, blanks dropped, and deduplicated case- and whitespace-
 * insensitively (first occurrence wins, so the creator's order is kept).
 * Polis rejects a repeated statement with `polis_err_post_comment_duplicate`,
 * and before 2026-09-04 that error aborted the whole seeding loop, leaving an
 * approved conversation stuck at "waiting to start" with an orphan on Polis.
 */
export function parseSeedStatements(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const key = s.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
