// SourceLinks — compact, numbered "Sources" list rendered from the raw
// one-per-line sources a creator (or the assistant) entered. Each line is
// expected as "Short title: URL"; we extract the URL for the href and use
// the remaining text as the link label, so readers see titles, never raw
// URLs. Lines without a title fall back to the link's hostname.

import "./SourceLinks.css";

export interface ParsedSource {
  label: string;
  url: string;
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

interface Props {
  /** Raw source lines ("Short title: URL"), already split from the field. */
  sources: string[];
  /** Render cap — the form and submit path also cap, this is belt-and-braces. */
  max?: number;
}

export default function SourceLinks({ sources, max = 6 }: Props) {
  const parsed = sources
    .map(parseSourceLine)
    .filter((s): s is ParsedSource => s !== null)
    .slice(0, max);

  if (parsed.length === 0) return null;

  return (
    <div className="source-links">
      <span className="source-links-label">Sources</span>
      <ol className="source-links-list">
        {parsed.map((s, i) => (
          <li key={i}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.label}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
