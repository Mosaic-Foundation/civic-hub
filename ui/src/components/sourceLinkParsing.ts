// Reading a "Short title: URL" line (split from SourceLinks.tsx).

export interface ParsedSource {
  label: string;
  url: string;
}

/**
 * A stored link that may be either shape: a raw "Title: URL" line, or a
 * `{url, label}` pair whose `url` is itself a whole line. Votes stored the
 * latter — `optionalLinks.map(url => ({url, label: url}))` in
 * voteDraftController — so the href was the entire line and the browser
 * resolved it as a RELATIVE path, landing on a blank hub page. Normalizing
 * here fixes every row already in the database, not just new ones.
 */
export function normalizeSourceLink(input: {
  url: string;
  label?: string;
}): ParsedSource | null {
  const parsed = parseSourceLine(input.url);
  if (parsed) {
    // A stored label that is not just a copy of the raw line wins.
    const label =
      input.label && input.label !== input.url ? input.label : parsed.label;
    return { label, url: parsed.url };
  }
  return parseSourceLine(input.label ?? "");
}

export function parseSourceLine(line: string): ParsedSource | null {
  const match = line.match(/https?:\/\/\S+/);
  if (!match || match.index === undefined) return null;

  // Trailing punctuation is prose, not URL.
  const url = match[0].replace(/[).,;]+$/, "");

  let label = (line.slice(0, match.index) + line.slice(match.index + match[0].length))
    .replace(/^[\s:—–-]+/, "")
    .replace(/[\s:—–-]+$/, "")
    // A trailing parenthetical is elaboration, not title — drop it so
    // verbose lines still render as clean link text.
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

  if (!label) {
    try {
      label = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      label = url;
    }
  }

  return { label, url };
}
