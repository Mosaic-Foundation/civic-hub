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
  /** Its curated sample content for a new hub. */
  samples?: {
    /** The samples that fit the hub in scope (its kind, its jurisdiction type), in seeding order. */
    plan(): readonly SampleTemplate[];
    /** Seed one of them whose type's plugin does not seed it itself (PluginServer.samples). */
    seed(template: SampleTemplate, kit: SampleKit): Promise<void>;
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
