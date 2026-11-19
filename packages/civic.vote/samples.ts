// Votes' sample content (PluginServer.samples, kernel step 4): Votes seeds its
// own samples, through its own lifecycle. The words come from the hub's space
// type (the Civic Hub's: spaces/civic/sampleTemplates.ts), in its vocabulary;
// this says what a vote sample is made of and how it is seeded.
//
// - A proposed vote gathers its sample endorsements; its threshold never lets
//   one tester's endorsement open it (sampleSupportThreshold).
// - An open or closed vote has anonymous ballots (the kernel casts them:
//   SampleKit.ballots), and a closed one is tallied as the deadline close does.
// - Every event is stamped with its planned time.

import {
  ballots as ballotBox,
  type PluginSamples,
  type Process,
  type ProcessStatus,
  type SampleKit,
  type SampleTemplate,
} from "@civic-social/plugin-sdk";
import type { VoteProcessState } from "./models.js";
import * as v from "./service.js";
import { supportThreshold } from "./settings.js";

/** What a vote sample says. */
export interface VoteSample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Created, days relative to the seed. */
  readonly at: number;
  readonly title: string;
  readonly description: string;
  /**
   * The voting method. `yes_no_unsure` is the single-choice method (one
   * option per voter, any option list); `approval` lets a voter pick several.
   */
  readonly method: "yes_no_unsure" | "approval";
  /** Option labels, in order. */
  readonly options: readonly string[];
  /** open: ballots cast so far; closed: final; proposed: none yet. */
  readonly phase: "proposed" | "open" | "closed";
  readonly opens_at?: number;
  readonly closes_at?: number;
  /** Anonymous ballots per option, same order as `options`. */
  readonly ballots?: readonly number[];
  /** Endorsements while proposed. */
  readonly endorsed_by?: readonly string[];
}

/**
 * Endorsements a tester must add, beyond the seeded ones, before a sample vote
 * gathering endorsements opens (Adam, 2026-11-06): one tester's endorsement
 * must not open it into a live vote by accident.
 */
export const SAMPLE_ENDORSEMENT_FLOOR = 5;

/**
 * A sample vote's endorsement threshold: the hub's, but never fewer than
 * SAMPLE_ENDORSEMENT_FLOOR beyond its seeded endorsers, whatever the hub's
 * threshold (a hub's may be 0). Pure.
 */
export function sampleSupportThreshold(hubThreshold: number, seededEndorsers: number): number {
  return Math.max(hubThreshold, seededEndorsers + SAMPLE_ENDORSEMENT_FLOOR);
}

const DAY = 24 * 60 * 60 * 1000;

function ctx(kit: SampleKit, p: Process, iso: string) {
  return { process_id: p.id, jurisdiction: p.jurisdiction, emit: kit.emitAt(iso) };
}

/** Persist the way executeAction does: status + state, and process.updated on a status change. */
async function persist(kit: SampleKit, p: Process, st: VoteProcessState, previous: string, iso: string, actor: string): Promise<void> {
  p.status = st.status as ProcessStatus;
  p.state = st as unknown as Record<string, unknown>;
  await kit.save(p);
  if (previous !== p.status) {
    await kit.emitAt(iso)({
      event_type: "civic.process.updated",
      actor,
      process_id: p.id,
      jurisdiction: p.jurisdiction,
      processType: "civic.vote",
      data: { process: { previous_status: previous, status: p.status } },
    });
  }
}

/** Anonymous ballots, interleaved so they do not arrive option by option. */
async function castBallots(kit: SampleKit, p: Process, t: VoteSample): Promise<number> {
  const pool: string[] = [];
  t.options.forEach((opt, i) => {
    for (let k = 0; k < (t.ballots?.[i] ?? 0); k++) pool.push(kit.fill(opt));
  });
  let seed = 7;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const method = v.getVotingMethod(t.method);
  return kit.ballots(p.id, pool.map((opt) => (method.key === "approval" ? JSON.stringify([opt]) : opt)));
}

export async function seedVoteSample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  const t = template as unknown as VoteSample;
  const author = kit.author(t.by);
  const options = t.options.map((o) => kit.fill(o));
  const threshold = sampleSupportThreshold(supportThreshold(), t.endorsed_by?.length ?? 0);
  const p = await kit.create({
    title: kit.fill(t.title),
    description: kit.fill(t.description),
    state: {
      method: t.method,
      options,
      activation_mode: t.phase === "proposed" ? "proposal_required" : "direct",
      support_threshold: t.phase === "proposed" ? threshold : 0,
      voting_duration_ms: 14 * DAY,
    },
  });
  let st = p.state as unknown as VoteProcessState;

  if (t.phase === "proposed") {
    ({ state: st } = await v.propose(st, author.id, ctx(kit, p, kit.at(t.at, 1))));
    await persist(kit, p, st, "draft", kit.at(t.at, 1), author.id);
    let m = 2;
    for (const who of t.endorsed_by ?? []) {
      const u = kit.author(who);
      const prev = st.status;
      const iso = kit.at(t.at + m * 0.5);
      ({ state: st } = await v.addSupport(st, u.id, ctx(kit, p, iso)));
      await persist(kit, p, st, prev, iso, u.id);
      m++;
    }
    return;
  }

  const opens = kit.at(t.opens_at ?? t.at);
  ({ state: st } = await v.activate(st, author.id, ctx(kit, p, opens)));
  st.voting_opens_at = opens;
  st.voting_closes_at = kit.at(t.closes_at ?? 7);
  st.total_votes = await castBallots(kit, p, t);
  await persist(kit, p, st, "draft", opens, author.id);

  if (t.phase === "closed") {
    // Close as the deadline close does: tally from the anonymous receipts,
    // stamped with the deadline.
    const closed = st.voting_closes_at;
    const method = v.getVotingMethod(st.method ?? v.DEFAULT_METHOD);
    const cast = (await ballotBox.choices(p.id)).map((c) => method.parseReceipt(c));
    ({ state: st } = await v.closeVote(st, "system:auto-close", cast, ctx(kit, p, closed)));
    await persist(kit, p, st, "active", closed, "system:auto-close");
  }
}

export const voteSamples: PluginSamples = {
  seed: seedVoteSample,
  refresh: {
    // An open vote and one gathering endorsements; a closed vote never goes stale.
    live: (t) => (t as unknown as VoteSample).phase !== "closed",
    async reason(t, row, window) {
      if ((t as unknown as VoteSample).phase === "proposed") {
        return row.status === "proposed" ? null : `no longer gathering endorsements (${row.status})`;
      }
      if (row.status !== "active") return `no longer open (${row.status})`;
      return window.near(row.state?.voting_closes_at) ? "closes within the refresh window" : null;
    },
  },
};
