// A document field's text and the editable DOM it shows as: paragraphs, flat
// lists, bold, italic, links, and placeholders as locked chips. No dependency.
// What one gives, the other reads back; a field nobody touches is never read
// back into the document (DocumentEditor compares against its first reading).

import { chipLabel } from "../../../../../src/shared/documentFields";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function chipHtml(token: string): string {
  return `<span class="doc-chip" contenteditable="false" data-token="${escapeHtml(token)}">${escapeHtml(chipLabel(token))}</span>`;
}

const INLINE = /\{([A-Z_]+)\}|\*\*(.+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/;

function inlineToHtml(text: string): string {
  let out = "";
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) return out + escapeHtml(rest);
    out += escapeHtml(rest.slice(0, m.index));
    if (m[1]) out += chipHtml(m[1]);
    else if (m[2]) out += `<strong>${inlineToHtml(m[2])}</strong>`;
    else if (m[3]) out += `<em>${inlineToHtml(m[3])}</em>`;
    else out += `<a href="${escapeHtml(m[5])}">${inlineToHtml(m[4])}</a>`;
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const BULLET = /^[-*+]\s+(.*)$/;
const NUMBER = /^\d+[.)]\s+(.*)$/;

export function markdownToHtml(text: string): string {
  const html: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    // Runs of lines: a paragraph (tag null), or a list.
    const runs: Array<{ tag: "ul" | "ol" | null; lines: string[] }> = [];
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      const item = BULLET.exec(line) ?? NUMBER.exec(line);
      const tag = BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : null;
      const last = runs[runs.length - 1];
      if (last?.tag === tag) last.lines.push(item ? item[1] : line);
      else runs.push({ tag, lines: [item ? item[1] : line] });
    }
    for (const run of runs) {
      if (run.tag) html.push(`<${run.tag}>${run.lines.map((i) => `<li>${inlineToHtml(i)}</li>`).join("")}</${run.tag}>`);
      else html.push(`<p>${run.lines.map(inlineToHtml).join("<br>")}</p>`);
    }
  }
  return html.join("") || "<p><br></p>";
}

function wrap(mark: string, inner: string): string {
  // Marks hug the words: "** bold **" is not bold.
  const body = inner.trim();
  if (!body) return inner;
  const lead = inner.slice(0, inner.indexOf(body));
  const trail = inner.slice(inner.indexOf(body) + body.length);
  return `${lead}${mark}${body}${mark}${trail}`;
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u00a0/g, " ").replace(/\n/g, " ");
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.token) return `{${node.dataset.token}}`;
  const inner = [...node.childNodes].map(inlineMarkdown).join("");
  switch (node.tagName) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B":
      return wrap("**", inner);
    case "EM":
    case "I":
      return wrap("*", inner);
    case "A":
      return node.getAttribute("href") ? `[${inner}](${node.getAttribute("href")})` : inner;
    default:
      return inner;
  }
}

const BLOCKS = new Set(["P", "DIV", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "BLOCKQUOTE"]);

/** The field's text, from what's in the editable element. */
export function domToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  let line = "";
  const end = () => {
    const text = line.replace(/\n+$/, "");
    if (text.trim()) blocks.push(text);
    line = "";
  };
  const walk = (parent: Node) => {
    for (const node of parent.childNodes) {
      if (node instanceof HTMLElement && (node.tagName === "UL" || node.tagName === "OL")) {
        end();
        const numbered = node.tagName === "OL";
        const items = [...node.querySelectorAll("li")].map((li, i) => {
          const words = [...li.childNodes]
            .filter((c) => !(c instanceof HTMLElement && (c.tagName === "UL" || c.tagName === "OL")))
            .map(inlineMarkdown)
            .join("")
            .replace(/\n+/g, " ")
            .trim();
          return `${numbered ? `${i + 1}.` : "-"} ${words}`;
        });
        if (items.length) blocks.push(items.join("\n"));
      } else if (node instanceof HTMLElement && BLOCKS.has(node.tagName) && !node.dataset.token) {
        end();
        walk(node);
        end();
      } else {
        line += inlineMarkdown(node);
      }
    }
  };
  walk(root);
  end();
  return blocks.join("\n\n");
}
