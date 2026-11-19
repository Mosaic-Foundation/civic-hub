// Seeding a hub's sample content (Phase 7; kernel step 3, the samples hook).
// Contract: BUILD-PLAN-multi-tenant.md "Phase 7: Sample content for new hubs";
// the hook: src/plugins/samples.ts and docs/BUILD-A-PLUGIN.md. Run inside the
// hub's scope by scripts/seed-sample-content.ts, by the console's Create hub
// (the operator API's seedSamples) and by the sample refresh.
//
// The kernel names no type and holds no sample of its own:
// - The plan: the samples the hub's space type brings (SpaceServer.samples,
//   config/space.ts), then each loaded plugin's own defaults for a type the
//   space type brings none of. A sample made from another (`needs`) is
//   skipped when that one is not in the plan.
// - The seeding: each sample goes to the plugin that provides its type when
//   it seeds its own (PluginServer.samples.seed), to the space type otherwise.
//   Either gets a SampleKit: the sample people, times relative to now, the
//   hub's names, and a create that marks the process as sample (the database
//   stamps its events as sample, so none of it reaches /events or a digest).
// - Idempotent: fixed ids (proc_sample_<hub>_<key>, user_sample_<hub>_00n); a
//   sample whose process exists is skipped, the sample people are upserted.
// - The hub's plugin switches are NOT consulted (Adam, 2026-09-27): the run sees
//   every plugin on, so the real create paths accept every sample. Content
//   whose plugin is off stays hidden, like any process of that type, until the
//   plugin is turned on; removal takes all of it either way.

import { randomUUID } from "node:crypto";
import { forHub, type HubDb, type TableName } from "../db/forHub.js";
import { currentHub, currentHubId, currentHubSettings, withHubScope } from "../config/hubContext.js";
import { PLUGIN_IDS } from "../models/hubSettings.js";
import type { CreateEventInput } from "../models/event.js";
import type { ProcessContent } from "../models/process.js";
import { sampleProcessId, sampleUserId } from "../models/sampleContent.js";
import { emitEvent } from "../events/eventEmitter.js";
import { createProcess, getProcess, saveProcessState } from "./processService.js";
import { getSettingSync, isPluginEnabled, setSetting } from "./hubSettings.js";
import { processExistsOnHub, processVersionOnHub, stampProcessCreatedAt } from "./processRows.js";
import { fillSample, sampleNames, type SampleNames } from "./sampleNames.js";
import { SAMPLE_AUTHORS } from "./samplePeople.js";
import { sampleBallotTagsForThisHub } from "./sampleBallotTags.js";
import { submitInput } from "../modules/civic.input/index.js";
import type { LoadedPackage } from "../plugins/loader.js";
import { spaceType } from "../plugins/spaceType.js";
import type { PluginSampleTemplate, SampleKit, SampleTemplate } from "../plugins/samples.js";

export interface SampleSeedReport {
  hub: string;
  dry_run: boolean;
  created: string[];
  existing: string[];
  skipped: Array<{ key: string; reason: string }>;
  authors: number;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Seed this hub's sample content. Runs in the hub's scope, re-entered with
 * every plugin switched on, so the real create paths (which refuse a process
 * type whose plugin is off) accept every sample. Only this run sees the
 * switches that way; the stored settings are not touched.
 */
export async function seedSampleContent(
  opts: {
    dryRun?: boolean;
    now?: Date;
    /** Only these sample keys (the sample refresh re-seeds one at a time). */
    only?: readonly string[];
  } = {},
): Promise<SampleSeedReport> {
  const hub = currentHub();
  if (!hub) currentHubId(); // throws the usual "no hub in scope"
  const settings = { ...(currentHubSettings() ?? {}) };
  for (const id of PLUGIN_IDS) settings[`plugin.${id}.enabled`] = "true";
  return withHubScope(hub!, settings, () => seedInScope(opts));
}

// The loaded packages, read on first use, never as the engine starts: the
// loader imports every package, and a package imports the SDK by name, which
// the hub installs only once the engine has loaded (ADR-017).
let packages: readonly LoadedPackage[] = [];

/** Who seeds samples of a type: the plugin that provides it, when it offers to. */
function pluginSeeder(type: string) {
  const p = packages.find((x) => x.type === type);
  const samples = p?.server.samples;
  return p && samples ? { plugin: p.plugin, seed: samples.seed.bind(samples) } : null;
}

/**
 * The run's plan (pure): the space type's samples, then each plugin's
 * defaults for a type the space type brings none of, narrowed to `only`. A
 * sample is skipped when its key is taken, nothing seeds its type, or the
 * sample it is made from is not planned before it.
 */
export function planSamples(input: {
  fromSpace: readonly SampleTemplate[];
  defaults: ReadonlyArray<{ type: string; templates: readonly PluginSampleTemplate[] }>;
  only?: readonly string[];
  canSeed: (t: SampleTemplate) => boolean;
}): { plan: SampleTemplate[]; skipped: Array<{ key: string; reason: string }> } {
  const spaceTypes = new Set(input.fromSpace.map((t) => t.type));
  const all: SampleTemplate[] = [...input.fromSpace];
  for (const d of input.defaults) {
    if (spaceTypes.has(d.type)) continue;
    for (const t of d.templates) all.push({ ...t, type: d.type });
  }
  const plan: SampleTemplate[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const keys = new Set<string>();
  for (const t of all) {
    if (input.only && !input.only.includes(t.key)) continue;
    if (keys.has(t.key)) {
      skipped.push({ key: t.key, reason: `another sample already has the key ${t.key}` });
      continue;
    }
    keys.add(t.key);
    if (!input.canSeed(t)) {
      skipped.push({ key: t.key, reason: `nothing on this hub seeds ${t.type}` });
      continue;
    }
    if (t.needs && !plan.some((p) => p.key === t.needs)) {
      skipped.push({ key: t.key, reason: `the sample it is made from (${t.needs}) is not seeded` });
      continue;
    }
    plan.push(t);
  }
  return { plan, skipped };
}

async function seedInScope(opts: { dryRun?: boolean; now?: Date; only?: readonly string[] }): Promise<SampleSeedReport> {
  const hubId = currentHubId();
  const space = spaceType();
  const run = new SeedRun(hubId, sampleNames(), opts.now ?? new Date());
  packages = (await import("../plugins/loader.js")).loadedPackages();
  const defaults = packages.flatMap((p) => {
    const d = p.server.samples?.defaults?.();
    return d?.length ? [{ type: p.type, templates: d }] : [];
  });
  const { plan, skipped } = planSamples({
    fromSpace: space?.samples?.plan() ?? [],
    defaults,
    only: opts.only,
    canSeed: (t) => !!pluginSeeder(t.type) || !!space?.samples?.seed,
  });
  const report: SampleSeedReport = {
    hub: hubId,
    dry_run: !!opts.dryRun,
    created: [],
    existing: [],
    skipped,
    authors: Object.keys(SAMPLE_AUTHORS).length,
  };
  if (opts.dryRun) {
    for (const t of plan) {
      ((await run.exists(t.key)) ? report.existing : report.created).push(t.key);
    }
    return report;
  }

  await run.upsertAuthors();
  for (const t of plan) {
    if (await run.exists(t.key)) {
      report.existing.push(t.key);
      continue;
    }
    const own = pluginSeeder(t.type);
    if (own) await own.seed(t, run.kit(t, own.plugin));
    else await space!.samples!.seed!(t, run.kit(t, null));
    report.created.push(t.key);
  }
  return report;
}

/** One seed run on one hub: the kit each sample gets, and the sample people. */
class SeedRun {
  private readonly db: HubDb;

  constructor(
    private readonly hubId: string,
    private readonly names: SampleNames,
    private readonly now: Date,
  ) {
    this.db = forHub(hubId);
  }

  private fill(text: string): string {
    return fillSample(text, this.names);
  }

  /** Days relative to now → ISO. `minutes` orders events within one day. */
  private at(days: number, minutes = 0): string {
    return new Date(this.now.getTime() + days * DAY + minutes * 60_000).toISOString();
  }

  private author(key: string): { id: string; name: string } {
    const a = (SAMPLE_AUTHORS as Record<string, { n: number; full_name: string }>)[key];
    if (!a) throw new Error(`no sample person ${key} (the kernel's are ${Object.keys(SAMPLE_AUTHORS).join(", ")})`);
    return { id: sampleUserId(this.hubId, a.n), name: this.fill(a.full_name) };
  }

  /** An emitter that stamps a planned time (the log cannot be backdated later). */
  private emitAt(iso: string) {
    return (input: CreateEventInput) => emitEvent({ ...input, timestamp: input.timestamp ?? iso });
  }

  private async stamp(table: TableName, match: Record<string, string>, iso: string, column = "created_at"): Promise<void> {
    let q = this.db.from(table).update({ [column]: iso });
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    await q;
  }

  async exists(key: string): Promise<boolean> {
    return processExistsOnHub(this.hubId, sampleProcessId(this.hubId, key));
  }

  async upsertAuthors(): Promise<void> {
    for (const a of Object.values(SAMPLE_AUTHORS)) {
      await this.db.from("users").upsert(
        {
          id: sampleUserId(this.hubId, a.n),
          email: `sample-${String(a.n).padStart(3, "0")}@${this.hubId}.sample.invalid`,
          email_verified: true,
          is_resident: true,
          full_name: this.fill(a.full_name),
          digest_frequency_days: null, // never in a digest run
          is_sample: true,
        },
        { onConflict: "hub_id,id" },
      );
    }
  }

  /** The kit for one sample; `plugin` is the seeding plugin's id (null: the space type). */
  kit(template: SampleTemplate, plugin: string | null): SampleKit {
    const hubId = this.hubId;
    return {
      hubId,
      now: this.now,
      template,
      fill: (text) => this.fill(text),
      at: (days, minutes) => this.at(days, minutes),
      id: (key) => sampleProcessId(hubId, key),
      process: async (key) => (await getProcess(sampleProcessId(hubId, key))) ?? null,
      author: (key) => this.author(key),
      emitAt: (iso) => this.emitAt(iso),
      create: async (input) => {
        const by = this.author(input.by ?? template.by ?? "TEAM");
        const at = this.at(input.at ?? template.at ?? 0);
        const p = await createProcess({
          id: sampleProcessId(hubId, template.key),
          definition: { type: template.type, version: input.version ?? "0.1" },
          title: input.title,
          description: input.description,
          createdBy: by.id,
          state: input.state,
          content: input.content as ProcessContent | undefined,
          eventTimestamp: at,
          isSample: true,
        });
        await stampProcessCreatedAt(hubId, p.id, at);
        // The stamp is a write, so it moved the row's version; this copy is the
        // seed's own and carries on from it (saveProcessState checks it).
        p.version = await processVersionOnHub(hubId, p.id);
        return p;
      },
      save: (p) => saveProcessState(p),
      comment: async (p, c, phase = "comment") => {
        const u = this.author(c.by);
        const iso = this.at(c.at);
        const input = await submitInput(
          p.id,
          u.id,
          this.fill(c.body),
          { jurisdiction: p.jurisdiction, emit: this.emitAt(iso) },
          phase,
          { is_anonymous: false, author_name: u.name },
        );
        await this.stamp("community_inputs", { id: input.id }, iso, "submitted_at");
        return input.id;
      },
      adoptSetting: async (key, value) => {
        if (!plugin || !key.startsWith(`plugin.${plugin}.`)) {
          throw new Error(`a sample may set only its own plugin's settings (plugin.${plugin ?? "<id>"}.*), not ${key}`);
        }
        if (getSettingSync(key as never)) return false;
        // The stored switch, not this run's (which sees every plugin on).
        if (!(await isPluginEnabled(hubId, plugin as never))) return false;
        await setSetting(hubId, key as never, value, "sample-seed");
        return true;
      },
      ballots: async (processId, choices) => {
        if (!processId.startsWith(sampleProcessId(hubId, ""))) {
          throw new Error(`sample ballots go on a sample process, not ${processId}`);
        }
        // No time on a ballot, sample or not (vote_records_no_time, 2026-10-10).
        // District and age tags on a demo hub only (sampleBallotTags.ts).
        const tags = sampleBallotTagsForThisHub(choices.length);
        const rows = choices.map((choice, i) => ({ receipt_id: randomUUID(), process_id: processId, choice, ...tags[i]! }));
        if (rows.length) await this.db.from("vote_records").insert(rows);
        return rows.length;
      },
    };
  }
}
