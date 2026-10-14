/**
 * Every "?" in the admin panel links to a place the docs publish (admin menu
 * slice, 2026-10-13). CI runs this after the unit tests.
 *
 *   npx tsx scripts/check-help-anchors.ts
 *   CIVIC_HELP_ANCHORS=../civic-hub-docs/docs/.vitepress/dist/help-anchors.json npx tsx scripts/check-help-anchors.ts
 *
 * It reads the docs site's own list, /help-anchors.json, which the docs build
 * writes from the pages it published (civic-hub-docs,
 * scripts/build-help-anchors.mjs). CIVIC_HELP_ANCHORS points it at another
 * URL or at a local file, for a docs change not yet deployed.
 *
 * Fails (exit 1) when a key that is not `pending`:
 *   - names a page the docs don't publish, or
 *   - names an anchor that page doesn't have (a heading reworded without its
 *     {#id}, a section removed).
 * Fails too when the list can't be read: an unchecked link is not a checked
 * one. Lists, without failing, the pending keys the docs now publish, so
 * their `pending` flag can come off.
 */

import { readFileSync } from "node:fs";
import { DOCS_BASE_URL, HELP } from "../src/shared/helpRegistry.js";

interface AnchorList {
  site?: string;
  generated_at?: string;
  pages: Record<string, string[]>;
}

/** "/reference/settings/" and "/reference/settings" are one page. */
function norm(page: string): string {
  return page.length > 1 ? page.replace(/\/$/, "") : page;
}

async function load(source: string): Promise<AnchorList> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${source} answered ${res.status}`);
    return (await res.json()) as AnchorList;
  }
  return JSON.parse(readFileSync(source, "utf8")) as AnchorList;
}

export function checkHelpAnchors(list: AnchorList): { errors: string[]; published: string[] } {
  const pages = new Map(Object.entries(list.pages).map(([p, ids]) => [norm(p), new Set(ids)]));
  const errors: string[] = [];
  const published: string[] = [];
  for (const [key, entry] of Object.entries(HELP)) {
    const ids = pages.get(norm(entry.page));
    if (entry.pending) {
      if (!ids) errors.push(`${key}: pending, but its page ${entry.page} isn't published, so the link would open a missing page`);
      else if (ids.has(entry.anchor)) published.push(key);
      continue;
    }
    if (!ids) errors.push(`${key}: the docs don't publish ${entry.page}`);
    else if (!ids.has(entry.anchor)) errors.push(`${key}: ${entry.page} has no #${entry.anchor}`);
  }
  return { errors, published };
}

async function main(): Promise<void> {
  const source = process.env.CIVIC_HELP_ANCHORS?.trim() || `${DOCS_BASE_URL}/help-anchors.json`;
  let list: AnchorList;
  try {
    list = await load(source);
  } catch (err) {
    console.error(`help anchors: could not read ${source}: ${(err as Error).message}`);
    process.exit(1);
  }
  const { errors, published } = checkHelpAnchors(list);
  const keys = Object.keys(HELP).length;
  console.log(`help anchors: ${keys} keys checked against ${source} (built ${list.generated_at ?? "?"})`);
  if (published.length) {
    console.log(`\nThe docs now publish these pending keys' anchors; take their "pending" off in src/shared/helpRegistry.json:`);
    for (const k of published) console.log(`  ${k}`);
  }
  if (errors.length) {
    console.error(`\n${errors.length} help link${errors.length === 1 ? "" : "s"} point${errors.length === 1 ? "s" : ""} nowhere:`);
    for (const e of errors) console.error(`  ${e}`);
    console.error(`\nFix the docs (keep the {#id}) or the key's page and anchor in src/shared/helpRegistry.json.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
