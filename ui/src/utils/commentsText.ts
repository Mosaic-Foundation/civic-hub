/** A review form's comments textarea as a list: one per line, trimmed, blank lines dropped. */
export function parseCommentsText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
