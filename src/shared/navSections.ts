// The hub's sections, in their one order (navigation slice, 2026-10-14).
//
// Feed first, always. Then the sections of the enabled process types (from
// the registry: TypeDisplay.section, served as `process_types`) and the hub's
// own Members page, in the hub's Section order (`nav.section_order`), with any
// section the order does not name after it in the default order. That one
// list is what the top tabs, the sidebar and the More sheet draw, and its
// first four are the phone's bottom bar (Adam, 2026-10-14). The Navigation
// setting only changes where it is drawn, never the order.
//
// Pure, so the rules are tested without a browser (tests/unit/navSections.test.ts).
// Share this hub, Feedback, About and Welcome follow the sections in every
// layout; they are links, not sections, and are not ordered.

import type { ProcessTypeDisplay } from "./typeDisplay.js";

export interface NavSection {
  id: string;
  /** Its name in the sidebar, the tabs and the More sheet. */
  label: string;
  /** One word for the phone's bar. */
  short: string;
  path: string;
  /** Detail pages that keep it highlighted (/proposal/… under Proposals). */
  detailPaths: readonly string[];
  /** A key in the UI's icon set. */
  icon: string;
  /** feed: always first; type: a process type's list; hub: one of the hub's own pages. */
  kind: "feed" | "type" | "hub";
}

export const FEED_SECTION: NavSection = {
  id: "feed",
  label: "Feed",
  short: "Feed",
  path: "/",
  detailPaths: [],
  icon: "feed",
  kind: "feed",
};

/** The hub's own sections, beside the types'. Members comes after Outcomes by default. */
const HUB_SECTIONS: ReadonlyArray<NavSection & { order: number }> = [
  { id: "members", label: "Members", short: "Members", path: "/members", detailPaths: [], icon: "members", kind: "hub", order: 60 },
];

/** How many sections the phone's bar shows before More (Feed is the first of them). */
export const BAR_SECTION_COUNT = 4;

/** A stored `nav.section_order` as a list of ids; anything unreadable is the default. */
export function parseSectionOrder(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Every section the hub has now, Feed first, in the hub's order.
 *
 * `enabled(plugin)` is the hub's plugin switch. A section the order names but
 * the hub doesn't have is skipped; one it has but the order doesn't name (a
 * plugin just switched on) comes after the named ones, in default order.
 */
export function orderedSections(input: {
  types: readonly ProcessTypeDisplay[];
  enabled: (plugin: string) => boolean;
  order: readonly string[];
}): NavSection[] {
  const available: Array<NavSection & { order: number }> = [];
  const seen = new Set<string>();
  for (const t of input.types) {
    const s = t.section;
    if (!s || seen.has(s.id) || !input.enabled(t.plugin)) continue;
    seen.add(s.id);
    available.push({
      id: s.id,
      label: s.label,
      short: s.short ?? s.label,
      path: s.path,
      detailPaths: s.detail_paths,
      icon: t.icon,
      kind: "type",
      order: s.order,
    });
  }
  available.push(...HUB_SECTIONS);
  available.sort((a, b) => a.order - b.order);

  const named = input.order
    .map((id) => available.find((s) => s.id === id))
    .filter((s): s is NavSection & { order: number } => s !== undefined);
  const rest = available.filter((s) => !named.includes(s));
  return [FEED_SECTION, ...[...named, ...rest].map(({ order: _order, ...s }) => s)];
}

/** The phone's bar: the first four sections. More is drawn after them. */
export function barSections(sections: readonly NavSection[]): NavSection[] {
  return sections.slice(0, BAR_SECTION_COUNT);
}

/** The section a page belongs to, for highlighting; null when none does (an admin page). */
export function sectionForPath(pathname: string, sections: readonly NavSection[]): string | null {
  for (const s of sections) {
    if (s.kind === "feed") {
      if (pathname === "/") return s.id;
      continue;
    }
    if (pathname === s.path || pathname.startsWith(`${s.path}/`)) return s.id;
    if (s.detailPaths.some((p) => pathname.startsWith(p))) return s.id;
  }
  return null;
}
