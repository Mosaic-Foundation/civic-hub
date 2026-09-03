/**
 * The description Markdown subset — shared by the backend and the UI.
 *
 * Descriptions (and project updates) accept a small Markdown subset:
 * **bold**, *italic*, "- " bullet lists, "1. " numbered lists, and
 * [text](url) links; a bold label on its own line is the convention for a
 * section ("**What we need right now**"). The UI renders it (RichText),
 * the drafting toolbar and the assistant both write it, and every
 * plain-text surface — search snippets, social previews, the Code of
 * Conduct check — runs the text through stripMarkdown() first so no
 * asterisks or brackets leak into an email or a Facebook card.
 *
 * Plain text is valid Markdown, so nothing written before this existed
 * changes; a description that never used a marker strips to itself.
 */

export const DESCRIPTION_MARKDOWN_RULE =
  "Descriptions accept a small Markdown subset: **bold**, *italic*, lists " +
  'with "- " or "1. ", and [link text](https://…). For a structured ' +
  "description, put a bold label on its own line — for example " +
  "**What we need right now** — followed by a list. No # headings, no HTML, no tables.";

export function stripMarkdown(text: string): string {
  if (!text) return "";
  return (
    text
      // images → alt text; links → link text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // inline code
      .replace(/`([^`]+)`/g, "$1")
      // bold / italic markers (paired only, so a stray asterisk survives)
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, "$2")
      // strikethrough
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      // headings, block quotes, list markers, horizontal rules — per line
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/^[ \t]*[-*+][ \t]+/gm, "")
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
      .replace(/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, "")
      // trailing two-space hard breaks
      .replace(/[ \t]{2,}\n/g, "\n")
  );
}
