// How a hub's document becomes what people read: the kind sections and the
// placeholders. Pure, so the server (src/services/hubDocuments.ts) and Hub
// settings' live preview say the same words.

import { HUB_KINDS, hubKindOf } from "./hubKind.js";
import { theName } from "./hubCopy.js";

const KIND_SECTION = new RegExp(
  `\\{\\{([#^])(${HUB_KINDS.map((k) => k.id).join("|")})\\}\\}([\\s\\S]*?)\\{\\{\\/\\2\\}\\}`,
  "g",
);

/**
 * Keep the sections that apply to this kind of hub and drop the rest:
 * `{{#place}}…{{/place}}` is for place hubs, `{{^place}}…{{/place}}` for every
 * other kind (2026-09-27). Any kind works the same way since 2026-10-07
 * (`{{^issue}}` — About's "not an advocacy effort" is untrue of a campaign).
 * A section may span lines. `kind` unset = place.
 */
export function resolveKindSections(template: string, kind: string | undefined): string {
  const actual = hubKindOf(kind);
  return template.replace(KIND_SECTION, (_m, flag: string, name: string, body: string) =>
    (flag === "#") === (actual === name) ? body : "",
  );
}

/**
 * Take the `{{#draft}}…{{/draft}}` notes out of a rendered document
 * (2026-10-07, review R15). "Draft starter content — review before launch"
 * is a reminder for the hub's admins, not something an evaluator should read
 * on the public terms page, so the document is served without it and the
 * notes travel beside it for the page to show admins only. A hub's stored
 * copy from before the markers existed carries the note as a bare blockquote;
 * that is taken out the same way.
 */
export function splitDraftNotes(text: string): { body: string; notes: string[] } {
  const notes: string[] = [];
  const take = (_m: string, note: string) => {
    notes.push(note.trim().replace(/^>\s*/, ""));
    return "";
  };
  const body = text
    .replace(/\{\{#draft\}\}([\s\S]*?)\{\{\/draft\}\}\n*/g, take)
    .replace(/^(> \*\*Draft starter content[^\n]*)\n*/m, take);
  return { body, notes };
}

/**
 * Replace `{NAME}` with its value, leaving unknown placeholders untouched,
 * after keeping only the kind sections that apply (values.HUB_KIND).
 */
export function applySubstitutions(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  // The article forms follow HUB_NAME unless the caller supplied them.
  const all: Record<string, string> = { ...values };
  if (values.HUB_NAME) {
    all.THE_HUB_NAME ??= theName(values.HUB_NAME);
    all.THE_HUB_NAME_CAP ??= theName(values.HUB_NAME, true);
  }
  // So do the operator's other forms (operatorValues sets all three for a hub).
  if (values.OPERATOR) {
    all.OPERATOR_NOUN ??= values.OPERATOR;
    all.OPERATOR_LINE ??= `${values.OPERATOR}\n`;
  }
  return resolveKindSections(template, values.HUB_KIND).replace(/\{([A-Z_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(all, name) ? all[name] : match,
  );
}

/**
 * {OPERATOR} with nobody named reads as the sentence it was written for:
 * "operated by its administrators". The two places that phrase doesn't fit
 * have their own forms: {OPERATOR_NOUN} in mid-sentence, and {OPERATOR_LINE},
 * the contact block's line, which is dropped. {OPERATOR_NAME} is what the
 * admin panel has called it; both work.
 */
export function operatorValues(name: string | undefined): Record<string, string> {
  const operator = name?.trim();
  return operator
    ? { OPERATOR: operator, OPERATOR_NAME: operator, OPERATOR_NOUN: operator, OPERATOR_LINE: `${operator}\n` }
    : { OPERATOR: "its administrators", OPERATOR_NAME: "its administrators", OPERATOR_NOUN: "the Hub's administrators", OPERATOR_LINE: "" };
}
