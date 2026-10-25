// SourceLinks — compact, numbered "Sources" list rendered from the raw
// one-per-line sources a creator (or the assistant) entered. Each line is
// expected as "Short title: URL"; we extract the URL for the href and use
// the remaining text as the link label, so readers see titles, never raw
// URLs. Lines without a title fall back to the link's hostname.

import { parseSourceLine } from "./sourceLinkParsing";
import "./SourceLinks.css";

interface Props {
  /** Raw source lines ("Short title: URL"), already split from the field. */
  sources: string[];
  /** Render cap — the form and submit path also cap, this is belt-and-braces. */
  max?: number;
}

export default function SourceLinks({ sources, max = 6 }: Props) {
  // A line with no usable URL is shown as plain text rather than dropped:
  // silently losing something a creator typed is worse than showing it
  // unlinked, and they can see it is wrong and fix it.
  const entries = sources
    .map((line) => ({ line, parsed: parseSourceLine(line) }))
    .filter((e) => e.line.trim().length > 0)
    .slice(0, max);

  if (entries.length === 0) return null;

  return (
    <div className="source-links">
      <span className="source-links-label">Sources</span>
      <ol className="source-links-list">
        {entries.map((e, i) => (
          <li key={i}>
            {e.parsed ? (
              <a href={e.parsed.url} target="_blank" rel="noopener noreferrer">
                {e.parsed.label}
              </a>
            ) : (
              e.line
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
