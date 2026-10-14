// The help registry (admin menu slice, 2026-10-13): every "?" in the admin
// panel, in one place. Each key has a short plain-language note and the docs
// page and anchor the note's link opens.
//
// The data is helpRegistry.json, so the docs repo's weekly refresh job reads
// it from a civic-hub checkout without TypeScript (civic-hub-docs,
// scripts/propose-updates.mjs). Keys:
//   settings.<section>        a Settings section (src/shared/adminAnchors.ts)
//   plugins.<plugin id>       a plugin's panel on Settings → Plugins
//   <section>.<part>          a part of a section (mode.allowlist)
//   <setting key>             one setting (identity.name, plugin.vote.min_duration_days)
//
// Keeping the three in step (software, docs, help):
//   - The docs publish every anchor they have at /help-anchors.json.
//   - CI (scripts/check-help-anchors.ts) fails when a key that is not
//     `pending` points at an anchor the docs don't publish, and lists the
//     pending keys the docs now cover, so their flag can come off.
//   - A new setting ships with `pending: true`. Its link opens the right page
//     until the docs write the section; the weekly docs job drafts a section
//     with that exact anchor for each pending key.

import registry from "./helpRegistry.json";

export interface HelpEntry {
  /** One or two short sentences, in the admin's terms. */
  text: string;
  /** The docs page, from the site's root: "/reference/settings/participation". */
  page: string;
  /** The id on that page the link opens: an explicit, stable id the docs keep. */
  anchor: string;
  /** The docs don't publish this anchor yet; the link opens the page's top meanwhile. */
  pending?: boolean;
}

export const DOCS_BASE_URL = "https://docs.civic.social";

export const HELP: Readonly<Record<string, HelpEntry>> = registry;

export type HelpKey = keyof typeof registry;

export function helpEntry(key: string): HelpEntry | undefined {
  return Object.prototype.hasOwnProperty.call(HELP, key) ? HELP[key] : undefined;
}

/** The docs link for a key: the page and its anchor, or the page alone while pending. */
export function helpUrl(entry: HelpEntry): string {
  return `${DOCS_BASE_URL}${entry.page}${entry.pending ? "" : `#${entry.anchor}`}`;
}

/** The anchor a key gets in the docs by convention: dots and underscores become hyphens. */
export function anchorForKey(key: string): string {
  return key.toLowerCase().replace(/[._]/g, "-");
}
