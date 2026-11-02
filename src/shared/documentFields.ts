// A document as a form (pilot readiness 2, Adam 2026-11-02): one plain field per
// section, in the wording of this hub's kind. Nobody editing it sees braces.
//
// The source keeps everything: joinDocument with no edits gives back the source
// byte for byte, and an edit replaces only that one field's text. So a section
// nobody touched keeps its {{#place}} logic; a section an admin rewrites holds
// what they wrote for this hub's kind (if the console later changes the kind,
// that wording stays as written, and the console's hub page says so). Draft
// notes are kept and never shown. Headings are labels, not fields.

import { resolveKindSections } from "./documentTemplate.js";

export type DocumentPart =
  /** Kept as it is, not shown: a heading, a rule, a draft note, another kind's section. */
  | { type: "fixed"; raw: string }
  /** Editable. `text` is `raw` in this hub's kind, placeholders and all. */
  | { type: "field"; id: string; label: string; lead: string; raw: string; trail: string; text: string }
  /** Formatting the editor can't change (a table, say): shown, and kept as it is. */
  | { type: "locked"; id: string; label: string; raw: string; text: string };

/** What the editor's fields can hold and give back: paragraphs, flat lists, bold, italic, links. */
const UNSUPPORTED = /^\s*\||^\s*```|^\s*>|<[a-zA-Z/!]|!\[|\{\{|^[ \t]{2,}(?:[-*+]|\d+[.)])\s/m;

const OPENING = "Opening";

function headingLabel(line: string, kind: string | undefined): string {
  return resolveKindSections(line, kind).replace(/^#+\s*/, "").trim();
}

/**
 * Split a document into fields. Headings start a new one (`byParagraph`, for a
 * short fragment with none, splits at blank lines instead). Boundaries are only
 * ever between kind sections, never inside one.
 */
export function splitDocument(source: string, kind: string | undefined, opts: { byParagraph?: boolean } = {}): DocumentPart[] {
  const parts: DocumentPart[] = [];
  let next = 0;
  let body = "";
  let label = "";
  let paragraph = 0;

  const flush = () => {
    if (!body) return;
    const raw = body;
    body = "";
    const core = raw.trim();
    if (!core) {
      parts.push({ type: "fixed", raw });
      return;
    }
    const text = resolveKindSections(core, kind).trim();
    if (!text) {
      parts.push({ type: "fixed", raw });
      return;
    }
    const start = raw.indexOf(core);
    const lead = raw.slice(0, start);
    const trail = raw.slice(start + core.length);
    const named = opts.byParagraph ? paragraphLabel(text, ++paragraph) : label || OPENING;
    const id = `f${next++}`;
    if (UNSUPPORTED.test(text)) parts.push({ type: "locked", id, label: named, raw, text });
    else parts.push({ type: "field", id, label: named, lead, raw: core, trail, text });
  };

  let depth = 0;
  let inDraft = false;
  for (const line of source.split(/(?<=\n)/)) {
    if (inDraft || line.includes("{{#draft}}")) {
      flush();
      parts.push({ type: "fixed", raw: line });
      inDraft = !line.includes("{{/draft}}");
      continue;
    }
    if (depth === 0 && (/^#{1,6}\s/.test(line) || line.trim() === "---" || /^> \*\*Draft starter content/.test(line))) {
      flush();
      parts.push({ type: "fixed", raw: line });
      if (line.startsWith("#")) label = /^#\s/.test(line) ? OPENING : headingLabel(line, kind);
      // What follows a rule isn't part of the section before it.
      else if (line.trim() === "---") label = "Closing note";
      continue;
    }
    body += line;
    depth += (line.match(/\{\{[#^][a-z_]+\}\}/g) ?? []).length - (line.match(/\{\{\/[a-z_]+\}\}/g) ?? []).length;
    if (opts.byParagraph && depth === 0 && line.trim() === "") flush();
  }
  flush();
  // Nothing at all to edit (a hub with no page yet): one empty field to start in.
  if (!parts.some((p) => p.type !== "fixed")) {
    parts.push({ type: "field", id: `f${next}`, label: opts.byParagraph ? "The paragraph" : "The page", lead: "", raw: "", trail: "", text: "" });
  }
  return parts;
}

function paragraphLabel(text: string, n: number): string {
  if (/\{CONTACT_EMAIL\}/.test(text)) return "The contact line";
  return n === 1 ? "The opening paragraph" : `Paragraph ${n}`;
}

/** The document again, with the fields that were edited (by id) in place of their source. */
export function joinDocument(parts: readonly DocumentPart[], edits: Readonly<Record<string, string>>): string {
  return parts
    .map((p) => {
      if (p.type === "field") return `${p.lead}${edits[p.id] ?? p.raw}${p.trail}`;
      return p.raw;
    })
    .join("");
}

/** What a placeholder is called on its locked chip. */
const CHIP_LABELS: Readonly<Record<string, string>> = {
  HUB_NAME: "hub name",
  THE_HUB_NAME: "hub name",
  THE_HUB_NAME_CAP: "hub name",
  OPERATOR: "operator",
  OPERATOR_NAME: "operator",
  OPERATOR_NOUN: "operator",
  OPERATOR_LINE: "operator",
  CONTACT_EMAIL: "contact email",
  HOSTNAME: "web address",
  PLACE: "place",
  JURISDICTION: "place and state",
  STATE: "state",
  GOVERNING_BODY: "governing body",
  GOVERNING_STATE: "governing-law state",
  WHO_RUNS_THIS: "who runs this site",
};

export function chipLabel(token: string): string {
  return CHIP_LABELS[token] ?? token.toLowerCase().replace(/_/g, " ");
}

/** The chips a toolbar offers to put back. */
export const INSERTABLE_CHIPS: readonly string[] = ["THE_HUB_NAME", "OPERATOR", "CONTACT_EMAIL"];
