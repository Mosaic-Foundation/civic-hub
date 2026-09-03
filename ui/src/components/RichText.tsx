import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./RichText.css";

/**
 * Renders the description Markdown subset (see src/shared/markdown.ts):
 * bold, italic, lists, links. One component for every description,
 * project update, and conversation framing, so formatting written with
 * the drafting toolbar or by the assistant looks the same on every page.
 *
 * Safety: raw HTML is skipped, elements outside the subset are unwrapped
 * to their text, images are never rendered, links open in a new tab with
 * rel="noopener". A single newline stays a line break (descriptions were
 * plain text with pre-wrap until now, so existing ones keep their shape).
 */

const ALLOWED = ["p", "strong", "em", "del", "ul", "ol", "li", "a", "br", "blockquote"];

const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * Single newlines become hard breaks so plain-text descriptions keep their
 * shape; blank lines still split paragraphs. No break is added where
 * Markdown already starts a new block — a list item, or the line before
 * one — otherwise every label above a list and every list item would end
 * in a stray <br> and the page would gap open.
 */
function preserveLineBreaks(text: string): string {
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      const next = lines[i + 1];
      if (!line.trim() || next === undefined || !next.trim()) return line;
      if (LIST_LINE.test(line) || LIST_LINE.test(next)) return line;
      return `${line}  `;
    })
    .join("\n");
}

export default function RichText({ text, className }: { text: string; className?: string }) {
  if (!text || !text.trim()) return null;
  return (
    <div className={`richtext${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {preserveLineBreaks(text)}
      </ReactMarkdown>
    </div>
  );
}
