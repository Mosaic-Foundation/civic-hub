// Every sample a hub could have (kernel step 4): the space type's, in its
// vocabulary, and each plugin's own defaults for a type the space type brings
// none of. Read by the sample refresh, the admin's and the console's "what
// changed" lists, and the console's create form. The kernel names no type:
// each plugin says what its samples are called and which are live.

import type { LoadedPackage } from "../plugins/loader.js";
import type { PluginSamples, SampleTemplate } from "../plugins/samples.js";
import { spaceType } from "../plugins/spaceType.js";
import { fillSample, type SampleNames } from "./sampleNames.js";

// The loaded packages, read on first use, never as the engine starts: the
// loader imports every package, and a package imports the SDK by name, which
// the hub installs only once the engine has loaded (ADR-017).
async function loaded(): Promise<readonly LoadedPackage[]> {
  return (await import("../plugins/loader.js")).loadedPackages();
}

/** What the plugin that provides this type offers for samples, or undefined. */
export async function pluginSamplesFor(type: string): Promise<PluginSamples | undefined> {
  return (await loaded()).find((p) => p.type === type)?.server.samples;
}

/** Each plugin's own defaults, as templates, for the types the space type brings none of. */
async function pluginDefaults(fromSpace: readonly SampleTemplate[]): Promise<SampleTemplate[]> {
  const spaceTypes = new Set(fromSpace.map((t) => t.type));
  return (await loaded()).flatMap((p) => {
    if (spaceTypes.has(p.type)) return [];
    return (p.server.samples?.defaults?.() ?? []).map((t) => ({ ...t, type: p.type }));
  });
}

/** The samples that fit the hub in scope: the space type's plan, then the plugins' defaults. */
export async function hubSamples(): Promise<SampleTemplate[]> {
  const fromSpace = spaceType()?.samples?.plan() ?? [];
  return [...fromSpace, ...(await pluginDefaults(fromSpace))];
}

/** Every sample, whichever hubs it fits. */
export async function everySample(): Promise<SampleTemplate[]> {
  const fromSpace = spaceType()?.samples?.all() ?? [];
  return [...fromSpace, ...(await pluginDefaults(fromSpace))];
}

/** What a sample is called on a page, unfilled: its plugin's say, else its `title`, else its key. */
export async function sampleTitle(t: SampleTemplate): Promise<string> {
  const own = (await pluginSamplesFor(t.type))?.title?.(t);
  if (own) return own;
  return typeof t.title === "string" ? t.title : t.key;
}

/**
 * Every sample's title, filled with one hub's names, by key: the "Refresh
 * samples" results name what changed by title, not by id.
 */
export async function sampleTitles(names: SampleNames): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of await everySample()) out[t.key] = fillSample(await sampleTitle(t), names);
  return out;
}

/** The console's create form: the hub kinds that start with samples. */
export function sampleKinds(): string[] {
  return spaceType()?.samples?.kinds?.() ?? [];
}

/** The console's create form: a sample card's first line per "<kind>:<type>". */
export function samplePreviews(): Record<string, { pill: string; title: string } | null> {
  return spaceType()?.samples?.previews?.() ?? {};
}
