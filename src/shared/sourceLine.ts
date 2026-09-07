// Parsing for the "Short title: URL" source lines a creator (or the
// assistant) types one per line. The rule text lives in the assistant's
// system prompt; this is the shared reader for it.
//
// Mirrors ui/src/components/SourceLinks.tsx — the two builds do not share a
// module, so `tests/unit/sourceLine.test.ts` pins the behavior on this side.

export interface ParsedSourceLine {
  label: string;
  url: string;
}

/**
 * Split a source line into its link text and its href, or null when the line
 * holds no URL at all.
 *
 * Why this exists: voteDraftController stored `{url: line, label: line}` for
 * every source, so the href was the entire line ("DOE C-MAP program page:
 * https://…"). A browser treats that as a RELATIVE path and lands on a blank
 * hub page — the bug Adam hit on 2026-09-04.
 */
/**
 * A URL people type without the scheme — "www.civic.social",
 * "floydcountyva.gov/board" — is still a URL. Stored bare, the browser
 * treats it as a relative path on the hub (Adam, 2026-09-06: a vote's Links
 * rendered as raw JSON with `www.civic.social` as both url and label).
 * Match either form; give the bare one https://.
 */
export const URL_IN_LINE = /(?:https?:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/i;

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[).,;]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function parseSourceLine(line: string): ParsedSourceLine | null {
  const match = line.match(URL_IN_LINE);
  if (!match || match.index === undefined) return null;

  // Trailing punctuation is prose, not URL.
  const url = normalizeUrl(match[0]);

  let label = (line.slice(0, match.index) + line.slice(match.index + match[0].length))
    .replace(/^[\s:—–-]+/, "")
    .replace(/[\s:—–-]+$/, "")
    // A trailing parenthetical is elaboration, not title.
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

/** A source line as a stored content link. Lines with no URL keep the raw
 *  text on both fields rather than being dropped — losing what someone typed
 *  is worse than storing it unlinked, and the renderer shows it as text. */
export function sourceLineToContentLink(line: string): { url: string; label: string } {
  const parsed = parseSourceLine(line);
  return parsed ? { url: parsed.url, label: parsed.label } : { url: line, label: line };
}
