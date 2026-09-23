// A hub's legal and policy documents.
//
// DECIDED WITH ADAM, 2026-09-22: every hub shares one set of documents, with
// the place-specific names substituted in. Terms, privacy, the code of conduct
// and the proposal best-practices guide are the same text everywhere; only the
// hub's name, place, state and governing body differ. Per-hub authoring is
// worth having later, so a hub CAN override any document with its own
// `legal.*` or `copy.about` settings row — but nothing has to, and nothing
// does today.
//
// Resolution for each document:
//   1. the hub's own settings row, if it has written one
//   2. the shared template in config/legal/, with placeholders substituted
//
// WHY THE SERVER SERVES THESE. They used to be imported into the UI bundle
// with Vite's `?raw`, which compiles one hub's text into the build — the exact
// thing this phase exists to undo. They are also 30 KB between them, so they
// are deliberately kept out of the per-request settings snapshot and out of
// the boot config, and are fetched only by the pages that render one.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchHubDocuments } from "../db/hubSettingsStore.js";
import { getSettingSync } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import type { Hub } from "../models/hub.js";

/** Document key -> the shared template that backs it. */
const TEMPLATES: Readonly<Record<string, string>> = {
  [KEYS.LEGAL_TERMS]: "terms.md",
  [KEYS.LEGAL_PRIVACY]: "privacy.md",
  [KEYS.LEGAL_CODE_OF_CONDUCT]: "code-of-conduct.md",
  [KEYS.LEGAL_PROPOSAL_BEST_PRACTICES]: "proposal-best-practices.md",
};

export type HubDocuments = Record<string, string>;

/**
 * Templates are read from disk once and kept. They are part of the deployment,
 * not of any hub, so they cannot change while the process is running.
 *
 * Vercel does not reliably bundle files that nothing imports, so the read is
 * tried against several roots and a miss is survivable: a document that cannot
 * be loaded is omitted, and the page that wanted it falls back to its own
 * bundled copy rather than showing nothing.
 */
const templateCache = new Map<string, string | null>();

function candidateRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(here, "../../config/legal"), // dist/ and src/ both sit two deep
    resolve(here, "../../../config/legal"),
    resolve(process.cwd(), "config/legal"),
    "/var/task/config/legal",
  ];
}

function readTemplate(fileName: string): string | null {
  const cached = templateCache.get(fileName);
  if (cached !== undefined) return cached;

  for (const root of candidateRoots()) {
    try {
      const text = readFileSync(resolve(root, fileName), "utf-8");
      templateCache.set(fileName, text);
      return text;
    } catch {
      // try the next root
    }
  }
  console.error(`[hub-documents] template not found: ${fileName}`);
  templateCache.set(fileName, null);
  return null;
}

/**
 * The substitutions a hub makes in a shared document.
 *
 * `{PLACE}` and `{STATE}` are derived from `jurisdiction_name` rather than
 * being their own settings, because "Floyd County, Virginia" already contains
 * both and a hub should not have to state the same thing three times.
 *
 * `{HOSTNAME}` comes from the `hubs` row and from nowhere else — not from an
 * env var, not from a literal. A legal document that names the wrong domain
 * is a document about somebody else's website, which is exactly what Athens
 * was serving before 2026-09-23.
 *
 * `{OPERATOR}` and `{CONTACT_EMAIL}` are the two settings added the same day.
 * Terms and a privacy policy have to name who is answerable and how to reach
 * them; shared templates cannot, so the hub says it once and all four
 * documents read it.
 *
 * A placeholder with no value is LEFT AS IT IS, deliberately. The documents
 * are draft starter content and say so; a hub that has not configured its
 * governing body should show `{GOVERNING_BODY}` in review, not quietly render
 * a sentence with a hole in it.
 */
export function substitutions(hub: Hub): Record<string, string> {
  const jurisdiction = hub.jurisdiction_name?.trim() ?? "";
  const [place, ...rest] = jurisdiction.split(",");
  const state = rest.join(",").trim();

  const out: Record<string, string> = {};
  if (hub.name) out.HUB_NAME = hub.name;
  if (hub.hostname) out.HOSTNAME = hub.hostname;
  if (jurisdiction) out.JURISDICTION = jurisdiction;
  if (place?.trim()) out.PLACE = place.trim();
  if (state) out.STATE = state;

  const governingBody = getSettingSync(KEYS.COPY_GOVERNING_BODY_NAME);
  if (governingBody) out.GOVERNING_BODY = governingBody;

  const operator = getSettingSync(KEYS.LEGAL_OPERATOR_NAME);
  if (operator) out.OPERATOR = operator;

  const contactEmail = getSettingSync(KEYS.LEGAL_CONTACT_EMAIL);
  if (contactEmail) out.CONTACT_EMAIL = contactEmail;

  return out;
}

/** Replace `{NAME}` with its value, leaving unknown placeholders untouched. */
export function applySubstitutions(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{([A-Z_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match,
  );
}

/**
 * Every document for a hub: its own overrides where it has them, the shared
 * templates everywhere else.
 */
export async function hubDocuments(hub: Hub): Promise<HubDocuments> {
  const overrides = await fetchHubDocuments(hub.id);
  const values = substitutions(hub);
  const out: HubDocuments = {};

  for (const [key, fileName] of Object.entries(TEMPLATES)) {
    // A hub's own document goes through substitution too. Whoever authored it
    // gets the same placeholders as the shared templates, so they can write
    // "{HUB_NAME}" instead of hard-coding a name that a rename would strand.
    const override = overrides[key];
    const source = override || readTemplate(fileName);
    if (source !== null && source !== undefined) {
      out[key] = applySubstitutions(source, values);
    }
  }

  // copy.about and copy.welcome have no shared template — a hub either writes
  // one or has none. There is no generic version of "why I built this and who
  // I am", and a hub that has not written one should show nothing rather than
  // somebody else's introduction.
  for (const key of [KEYS.COPY_ABOUT, KEYS.COPY_WELCOME]) {
    const authored = overrides[key];
    if (authored) out[key] = applySubstitutions(authored, values);
  }

  return out;
}

/** One document, for the server-side consumers (the drafting assistant). */
export async function hubDocument(
  hub: Hub,
  key: string,
): Promise<string | null> {
  return (await hubDocuments(hub))[key] ?? null;
}
