// What a space type gives the kernel (kernel step 3; docs/kernel/SURFACE.md,
// "Space types"). A space type is the layer above the kernel that makes it a
// Civic Hub, or another kind of space: here, what a new hub of its type starts
// with and what a development database is seeded with. The hosting layer
// names the hub's space type in config/space.ts, the one place the kernel
// reads it (eslint `civic/package-boundary`); the kernel never names one.

import type { SampleKit, SampleTemplate } from "./samples.js";

export interface SpaceServer {
  /** What it is called: "Civic Hub". */
  readonly name: string;
  /**
   * Its curated sample content for a new hub: the words, in its vocabulary.
   * Each plugin seeds its own type (PluginServer.samples).
   */
  samples?: {
    /** The samples that fit the hub in scope (its kind, its jurisdiction type), in seeding order. */
    plan(): readonly SampleTemplate[];
    /** Every sample it has, whichever hubs it fits (a sample's title, its template by key). */
    all(): readonly SampleTemplate[];
    /** Seed one whose type's plugin does not seed its own. Left out: such a sample is skipped. */
    seed?(template: SampleTemplate, kit: SampleKit): Promise<void>;
    /** The console's create form: the hub kinds it has samples for. */
    kinds?(): string[];
    /** The console's create form: one sample card's first line per "<kind>:<type>", placeholders left in. */
    previews?(): Record<string, { pill: string; title: string } | null>;
  };
  /**
   * The development seed (CIVIC_ALLOW_SEED only, never production; the kernel
   * checks before it calls either).
   */
  dev?: {
    /** A hub with no processes, on its first request: its scenarios. */
    seedEmptyHub(hubId: string): Promise<void>;
    /** After /debug/seed wiped the hub: its scenarios, as created. */
    seedAfterReset(): Promise<Array<Record<string, unknown>>>;
  };
}
