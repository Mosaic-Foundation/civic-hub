// Sample content, as a plugin and a space type make it (kernel step 3; Adam,
// 2026-11-17: "some kind of standard way for plugin creators to speak to the
// hub to create demo data").
//
// The kernel seeds a hub's samples (src/services/sampleSeed.ts): it asks the
// hub's space type which samples a new hub of that type starts with, adds
// each plugin's own default samples for a type the space type brings none of,
// and hands each sample to whoever seeds its type: the plugin that provides
// the type when it offers `samples.seed` (PluginServer.samples), the space
// type otherwise. Whoever seeds it gets a SampleKit: the hub's sample people,
// times relative to now, the hub's names filled into a text, and a way to
// create a process that is marked as sample from the start, so none of it
// reaches the public log or a digest and removing the samples takes all of it.

import type { CivicEvent, CreateEventInput } from "../models/event.js";
import type { Process } from "../models/process.js";

/**
 * One sample: a key unique on the hub (its process id is made from it), the
 * process type it is, and the fields the type's seeder reads. `by` names one
 * of the sample people (SampleKit.author) and `at` a day relative to now; both
 * are what SampleKit.create uses unless it is told otherwise.
 */
export interface SampleTemplate {
  readonly key: string;
  readonly type: string;
  /** The key of a sample this one is made from (a vote's brief): seeded first, or this one is skipped. */
  readonly needs?: string;
  readonly by?: string;
  readonly at?: number;
  readonly [field: string]: unknown;
}

/** A plugin's own default sample: a template without its type, which is the plugin's. */
export interface PluginSampleTemplate {
  readonly key: string;
  readonly needs?: string;
  readonly by?: string;
  readonly at?: number;
  readonly [field: string]: unknown;
}

/** What a seeder gets for one sample, for the hub in scope. */
export interface SampleKit {
  /** The hub being seeded. */
  readonly hubId: string;
  /** The seed's now: every time a sample shows is relative to it. */
  readonly now: Date;
  /** The template being seeded. */
  readonly template: SampleTemplate;
  /** A sample text with the hub's names filled in ({PLACE}, {JURISDICTION}, {HUB_NAME}, ...). */
  fill(text: string): string;
  /** `days` from now (negative: before), plus `minutes` to order things within a day, as ISO. */
  at(days: number, minutes?: number): string;
  /** The process id of the sample with this key on this hub. */
  id(key: string): string;
  /** The sample process with this key on this hub (the one this sample is made from), or null. */
  process(key: string): Promise<Process | null>;
  /**
   * One of the hub's sample people (JORDAN, PRIYA, TEAM, ...; the kernel keeps
   * them and removes them with the samples). Unknown keys throw.
   */
  author(key: string): { id: string; name: string };
  /** An emitter that stamps a planned time, for the events of a sample (the log cannot be backdated later). */
  emitAt(iso: string): (input: CreateEventInput) => Promise<CivicEvent>;
  /**
   * Create the sample's process, marked as sample, with this template's key,
   * type, author (`by`, else TEAM) and time (`at`, else now). Its created time is
   * stamped to that time.
   */
  create(input: {
    title: string;
    description: string;
    state?: Record<string, unknown>;
    content?: Record<string, unknown>;
    /** Its type's version, "0.1" when left out. */
    version?: string;
    by?: string;
    at?: number;
  }): Promise<Process>;
  /** Save a sample process's status and state (the kernel's saveProcessState). */
  save(process: Process): Promise<void>;
  /** A sample person's comment on a sample process, at a day relative to now. */
  comment(process: Process, c: { by: string; body: string; at: number }, phase?: "comment" | "update"): Promise<string>;
  /**
   * Set one of the seeding plugin's own settings (`plugin.<its id>.*`) when the
   * hub has no value for it and the plugin is switched on in the hub's stored
   * settings (a seed run sees every plugin on). True when it was set.
   * Removing the samples empties any plugin setting that names a removed
   * sample process (src/services/sampleContent.ts).
   */
  adoptSetting(key: string, value: string): Promise<boolean>;
  /**
   * Cast anonymous sample ballots on a sample process (the kernel keeps every
   * ballot): each choice as the type serializes it, with no voter and no time.
   * On a demo hub they carry the district and age spread, so a closed sample
   * shows its breakdowns. Returns how many were cast.
   */
  ballots(processId: string, choices: readonly string[]): Promise<number>;
}

/** The sample refresh's window (REFRESH_WINDOW_DAYS, a few days). */
export interface SampleRefreshWindow {
  readonly now: Date;
  /** A deadline within the window, or none at all: the sample must be replaced. */
  near(iso: unknown): boolean;
}

/** A sample process as the sample refresh reads it. */
export interface SampleRow {
  readonly id: string;
  readonly status: string;
  readonly state: Record<string, unknown> | null;
}

/**
 * What a plugin offers for sample content (PluginServer.samples). The plugin
 * seeds its own type; the words come from the hub's space type, in its
 * vocabulary, or from the plugin's own defaults when the space type brings
 * none of its type.
 */
export interface PluginSamples {
  /** Its own samples, seeded on a hub whose space type brings none of its type. */
  defaults?(): readonly PluginSampleTemplate[];
  /** Seed one sample of its type, from the space type's template or one of its defaults. */
  seed(template: SampleTemplate, kit: SampleKit): Promise<void>;
  /**
   * What a sample is called on a page (the admin's and the console's "what
   * changed" lists), unfilled. Left out: the template's `title`.
   */
  title?(template: SampleTemplate): string;
  /**
   * Keeping a demo hub current (src/services/sampleRefresh.ts): a sample of
   * its type that is there to show something live (an open vote, an open
   * proposal), and why one must be replaced now, or null. A sample it does
   * not call live is left alone.
   */
  refresh?: {
    live(template: SampleTemplate): boolean;
    reason(template: SampleTemplate, row: SampleRow, window: SampleRefreshWindow): Promise<string | null>;
  };
  /**
   * The console's "Refresh samples": the state an older sample of its type
   * should have now (a field added since it was seeded), or null to leave it.
   */
  repair?(template: SampleTemplate, state: Record<string, unknown>, fill: (text: string) => string): Record<string, unknown> | null;
}
