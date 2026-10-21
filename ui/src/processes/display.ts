// What the UI says about a process type, read from its manifest
// (src/shared/processManifests.ts; Architecture 2, ADR-009). No page keeps its
// own map of types to names, colours or paths: a type registered tomorrow is
// named, coloured and linked everywhere the moment its manifest exists.

import { MANIFEST_LIST } from "../../../src/shared/processManifests";
import type { ProcessManifest } from "../../../src/processes/manifest";
import type { PluginId } from "../../../src/shared/hubSettingsSections";

const BY_TYPE: ReadonlyMap<string, ProcessManifest> = new Map(MANIFEST_LIST.map((m) => [m.descriptor.type, m]));

/** A type's manifest, or undefined for a type this hub software does not carry. */
export function manifestOf(type: string | undefined): ProcessManifest | undefined {
  return type ? BY_TYPE.get(type) : undefined;
}

/**
 * What lists that mix types call one ("Vote", "Vote results", "Brief"): the
 * manifest's display name, else its label; an unknown type reads as its id
 * made legible ("civic.town_hall" → "town hall").
 */
export function typeName(type: string): string {
  const d = manifestOf(type)?.descriptor.display;
  return d?.name ?? d?.label ?? type.replace(/^civic\./, "").replace(/_/g, " ");
}

/**
 * The --type-<slug>-* colour family a type's own surfaces take (theme.css):
 * its manifest's colour, "generic" for a type without one.
 */
export function typeColorSlug(type: string): string {
  return manifestOf(type)?.color ?? "generic";
}

/**
 * The colour of a type's own feed cards (feed-pill--type-<slug>): the colour
 * its manifest's first card rule gives. An announcement is "announcement"; a
 * brief wears its source's colour, which a list of mixed types does not know,
 * so "generic"; a type with no cards, "generic".
 */
export function feedColorSlug(type: string): string {
  const card = manifestOf(type)?.feed?.cards[0]?.card;
  if (!card || card === "brief") return "generic";
  if (card === "announcement") return "announcement";
  return card.color;
}

/** The colour a Civic Brief of one of this type's processes wears (the Outcomes page). */
export function briefColorSlug(sourceType: string): string {
  return manifestOf(sourceType)?.feed?.brief?.color ?? "generic";
}

/** A process's page, from its type's manifest; the generic process route for an unknown type. */
export function detailPathOf(type: string, id: string): string {
  return manifestOf(type)?.detailPath(id) ?? `/process/${id}`;
}

/** The plugin that switches a type on and off. */
export function pluginOfType(type: string): PluginId | undefined {
  return manifestOf(type)?.descriptor.plugin as PluginId | undefined;
}

/** Whether any type of this plugin closes at a deadline (the Plugins page's warning). */
export function pluginHasDeadlines(plugin: string): boolean {
  return MANIFEST_LIST.some((m) => m.descriptor.plugin === plugin && m.descriptor.deadline !== null);
}

/** Every type a plugin switches, in registry order. */
export function typesOfPlugin(plugin: string): string[] {
  return MANIFEST_LIST.filter((m) => m.descriptor.plugin === plugin).map((m) => m.descriptor.type);
}

/** The name and one-line description of a process plugin (its manifest's pluginSection). */
export function processPluginCopy(plugin: string): { name: string; what: string } | undefined {
  const section = MANIFEST_LIST.find((m) => m.descriptor.plugin === plugin && m.pluginSection)?.pluginSection;
  return section ? { name: section.name, what: section.what } : undefined;
}

/** The plugin of the type whose detail page is at this route ("/process/" is the vote's). */
export function pluginOfDetailRoute(prefix: string): PluginId | undefined {
  const m = MANIFEST_LIST.find((x) => x.detailPath("x") === `${prefix}x`);
  return m?.descriptor.plugin as PluginId | undefined;
}
