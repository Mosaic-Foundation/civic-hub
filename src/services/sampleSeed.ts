// Seeding a hub's sample content (Phase 7): the templates in
// sampleTemplates.ts, filled with the hub's names and written through the
// real code paths, the way scripts/seedBetaSlate.ts wrote Floyd's slate
// (retired 2026-09-27; in git history up to 39ac22d).
//
// Contract: BUILD-PLAN-multi-tenant.md → "Phase 7 — Sample content for new
// hubs". Run inside the hub's scope by scripts/seed-sample-content.ts and by
// the console's Create hub (src/control/router.ts).
//
// - Real paths: processes through createProcess (marked `isSample`), votes
//   through the civic.vote module's lifecycle, proposals, projects and
//   comments through their modules, the outcome through the brief's own
//   approve path. The database stamps every event of a sample process as
//   sample, so none of it reaches /events or a digest.
// - Nothing leaves the building: the outcome's delivery goes to a mailer
//   that logs and sends nothing, the recipient label is the hub's governing
//   body with a `.invalid` address, the conversation is served by the
//   `seed-` mock layer (no Polis), and announcements skip the publication
//   receipt.
// - Times are relative to now: every event is stamped with its planned time
//   (the log cannot be backdated after the fact) and the row tables get
//   matching created_at, so the open vote is open and the feed looks current.
// - Idempotent: fixed ids (proc_sample_<hub>_<key>, user_sample_<hub>_00n);
//   a template whose process exists is skipped, authors are upserted.
// - Templates that do not fit the hub's jurisdiction type are skipped, and so
//   are those whose plugin the hub has switched off.

import { randomUUID } from "node:crypto";
import { forHub, type HubDb, type TableName } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { KEYS } from "../models/hubSettings.js";
import type { CreateEventInput } from "../models/event.js";
import type { Process, ProcessContent, ProcessStatus } from "../models/process.js";
import { sampleProcessId, sampleUserId } from "../models/sampleContent.js";
import { isJurisdictionType } from "../shared/jurisdictionType.js";
import { emitEvent } from "../events/eventEmitter.js";
import { createProcess, getProcess, saveProcessState } from "./processService.js";
import { getSettingSync, getSupportThreshold } from "./hubSettings.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { sampleDeliverySuppressed } from "./sampleContent.js";
import { sampleNames } from "./sampleNames.js";
import {
  SAMPLE_AUTHORS,
  fillSample,
  templatesFor,
  type SampleAnnouncement,
  type SampleDeliberation,
  type SampleNames,
  type SampleOutcome,
  type SampleProject,
  type SampleProposal,
  type SampleTemplate,
  type SampleVote,
} from "./sampleTemplates.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import * as vote from "../modules/civic.vote/index.js";
import type { VoteProcessState } from "../modules/civic.vote/index.js";
import { getBallotChoicesForProcess, clearActiveVoteKeysForProcess } from "../modules/civic.receipts/index.js";
import { createProposal, supportProposal } from "../modules/civic.proposals/index.js";
import { createProject, setProjectSentiment } from "../modules/civic.projects/index.js";
import { emitProjectUpdated } from "../modules/civic.projects/events.js";
import { submitInput } from "../modules/civic.input/index.js";
import { approveBrief, setRecipients, type BriefProcessState } from "../modules/civic.brief/index.js";
import { emitBriefAggregationCompleted } from "../modules/civic.brief/events.js";
import { emitAnnouncementResultPublished } from "../modules/civic.announcement/events.js";
import type { AnnouncementProcessState } from "../modules/civic.announcement/models.js";

/** The prefix the deliberation controller serves from the mock layer. */
export const SAMPLE_CONVERSATION_PREFIX = "seed-sample-";

const PROCESS_TYPE: Record<SampleTemplate["kind"], string> = {
  vote: "civic.vote",
  outcome: "civic.brief",
  proposal: "civic.proposal",
  deliberation: "civic.polis_deliberation",
  project: "civic.project",
  announcement: "civic.announcement",
};

export interface SampleSeedReport {
  hub: string;
  dry_run: boolean;
  created: string[];
  existing: string[];
  skipped: Array<{ key: string; reason: string }>;
  authors: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Seed this hub's sample content. Runs in the hub's scope. */
export async function seedSampleContent(opts: { dryRun?: boolean; now?: Date } = {}): Promise<SampleSeedReport> {
  const hubId = currentHubId();
  const run = new SeedRun(hubId, sampleNames(), opts.now ?? new Date());
  const typeRaw = getSettingSync(KEYS.IDENTITY_JURISDICTION_TYPE);
  const fitting = templatesFor(isJurisdictionType(typeRaw) ? typeRaw : null);
  const report: SampleSeedReport = {
    hub: hubId,
    dry_run: !!opts.dryRun,
    created: [],
    existing: [],
    skipped: [],
    authors: Object.keys(SAMPLE_AUTHORS).length,
  };

  const plan: SampleTemplate[] = [];
  for (const t of fitting) {
    const type = PROCESS_TYPE[t.kind];
    if (!isProcessTypeEnabled(type)) {
      report.skipped.push({ key: t.key, reason: `plugin for ${type} is off` });
      continue;
    }
    if (t.kind === "outcome" && !plan.some((p) => p.key === t.source)) {
      report.skipped.push({ key: t.key, reason: `its vote (${t.source}) is not seeded` });
      continue;
    }
    plan.push(t);
  }
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
    await run.seed(t);
    report.created.push(t.key);
  }
  return report;
}

class SeedRun {
  private readonly db: HubDb;

  constructor(
    private readonly hubId: string,
    private readonly names: SampleNames,
    private readonly now: Date,
  ) {
    this.db = forHub(hubId);
  }

  // --- helpers --------------------------------------------------------------

  private fill(text: string): string {
    return fillSample(text, this.names);
  }

  /** Days relative to now → ISO. `minutes` orders events within one day. */
  private at(days: number, minutes = 0): string {
    return new Date(this.now.getTime() + days * DAY + minutes * 60_000).toISOString();
  }

  private id(key: string): string {
    return sampleProcessId(this.hubId, key);
  }

  private user(author: keyof typeof SAMPLE_AUTHORS): { id: string; name: string } {
    const a = SAMPLE_AUTHORS[author];
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
    const row = await this.db.from("processes").select<{ id: string }>("id").eq("id", this.id(key)).maybeSingle();
    return !!row;
  }

  async upsertAuthors(): Promise<void> {
    for (const key of Object.keys(SAMPLE_AUTHORS) as Array<keyof typeof SAMPLE_AUTHORS>) {
      const a = SAMPLE_AUTHORS[key];
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

  private async create(t: SampleTemplate, input: {
    title: string;
    description: string;
    state?: Record<string, unknown>;
    content?: Record<string, unknown>;
  }): Promise<Process> {
    const by = this.user(t.by);
    const at = this.at(t.at);
    const p = await createProcess({
      id: this.id(t.key),
      definition: { type: PROCESS_TYPE[t.kind], version: t.kind === "deliberation" ? "1.0" : "0.1" },
      title: input.title,
      description: input.description,
      createdBy: by.id,
      state: input.state,
      content: input.content as ProcessContent | undefined,
      eventTimestamp: at,
      isSample: true,
    });
    await this.stamp("processes", { id: p.id }, at);
    return p;
  }

  private async comment(processId: string, jurisdiction: string, c: { by: keyof typeof SAMPLE_AUTHORS; body: string; at: number }, phase: "comment" | "update"): Promise<string> {
    const u = this.user(c.by);
    const iso = this.at(c.at);
    const input = await submitInput(
      processId,
      u.id,
      this.fill(c.body),
      { jurisdiction, emit: this.emitAt(iso) },
      phase,
      { is_anonymous: false, author_name: u.name },
    );
    await this.stamp("community_inputs", { id: input.id }, iso, "submitted_at");
    return input.id;
  }

  // --- votes ----------------------------------------------------------------

  private voteCtx(p: Process, iso: string) {
    return { process_id: p.id, jurisdiction: p.jurisdiction, emit: this.emitAt(iso) };
  }

  /** Persist the way executeAction does: status + state, and process.updated on a status change. */
  private async persistVote(p: Process, st: VoteProcessState, previous: string, iso: string, actor: string): Promise<void> {
    p.status = st.status as ProcessStatus;
    p.state = st as unknown as Record<string, unknown>;
    await saveProcessState(p);
    if (previous !== p.status) {
      await this.emitAt(iso)({
        event_type: "civic.process.updated",
        actor,
        process_id: p.id,
        jurisdiction: p.jurisdiction,
        processType: "civic.vote",
        data: { process: { previous_status: previous, status: p.status } },
      });
    }
  }

  /** Anonymous ballots (receipt + choice, no person), spread over the window. */
  private async ballots(p: Process, t: SampleVote, fromIso: string, toIso: string): Promise<number> {
    const pool: string[] = [];
    t.options.forEach((opt, i) => {
      for (let k = 0; k < (t.ballots?.[i] ?? 0); k++) pool.push(this.fill(opt));
    });
    // Deterministic interleave, so the ballots do not arrive option by option.
    let seed = 7;
    for (let i = pool.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const from = new Date(fromIso).getTime();
    const to = Math.min(new Date(toIso).getTime(), this.now.getTime() - 60_000);
    const method = vote.getVotingMethod(t.method);
    const rows = pool.map((opt, i) => ({
      receipt_id: randomUUID(),
      process_id: p.id,
      choice: method.key === "approval" ? JSON.stringify([opt]) : opt,
      created_at: new Date(from + ((to - from) * (i + 1)) / (pool.length + 1)).toISOString(),
    }));
    if (rows.length) await this.db.from("vote_records").insert(rows);
    return rows.length;
  }

  private async seedVote(t: SampleVote): Promise<void> {
    const author = this.user(t.by);
    const options = t.options.map((o) => this.fill(o));
    const threshold = Math.max(await getSupportThreshold(this.hubId), (t.endorsed_by?.length ?? 0) + 1);
    const p = await this.create(t, {
      title: this.fill(t.title),
      description: this.fill(t.description),
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
      ({ state: st } = await vote.propose(st, author.id, this.voteCtx(p, this.at(t.at, 1))));
      await this.persistVote(p, st, "draft", this.at(t.at, 1), author.id);
      let m = 2;
      for (const who of t.endorsed_by ?? []) {
        const u = this.user(who);
        const prev = st.status;
        const iso = this.at(t.at + m * 0.5);
        ({ state: st } = await vote.addSupport(st, u.id, this.voteCtx(p, iso)));
        await this.persistVote(p, st, prev, iso, u.id);
        m++;
      }
      return;
    }

    const opens = this.at(t.opens_at ?? t.at);
    ({ state: st } = await vote.activate(st, author.id, this.voteCtx(p, opens)));
    st.voting_opens_at = opens;
    st.voting_closes_at = this.at(t.closes_at ?? 7);
    st.total_votes = await this.ballots(p, t, opens, st.voting_closes_at);
    await this.persistVote(p, st, "draft", opens, author.id);

    if (t.phase === "closed") {
      // Close through the module, as the deadline close does: tally from the
      // anonymous receipts, stamped with the deadline.
      const closed = st.voting_closes_at;
      const method = vote.getVotingMethod(st.method ?? vote.DEFAULT_METHOD);
      const ballots = (await getBallotChoicesForProcess(p.id)).map((c) => method.parseReceipt(c));
      ({ state: st } = await vote.closeVote(st, "system:auto-close", ballots, this.voteCtx(p, closed)));
      await this.persistVote(p, st, "active", closed, "system:auto-close");
      await clearActiveVoteKeysForProcess(p.id);
    }
  }

  // --- outcome --------------------------------------------------------------

  private async seedOutcome(t: SampleOutcome): Promise<void> {
    const source = await getProcess(this.id(t.source));
    if (!source) throw new Error(`sample outcome ${t.key}: its vote ${t.source} is missing`);
    const team = this.user(t.by);
    const closedAt = this.at(t.at);
    const publishedAt = this.at(t.published_at);
    const record = await this.create(t, {
      title: source.title,
      description: source.description,
      state: {
        source_process_id: source.id,
        source_process_type: source.definition.type,
        content: {
          title: source.title,
          headline: this.fill(t.headline),
          summary: this.fill(t.summary),
          sections: t.sections.map((s) => ({ heading: this.fill(s.heading), body: this.fill(s.body) })),
          participation_label: this.fill(t.participation_label),
          participation_count: t.participation_count,
          comments: [],
          admin_notes: "",
          image_url: null,
          image_alt: null,
        },
      },
    });
    const state = record.state as unknown as BriefProcessState;
    const ctxAt = (iso: string) => ({ process_id: record.id, jurisdiction: record.jurisdiction, emit: this.emitAt(iso) });
    await emitBriefAggregationCompleted(ctxAt(this.at(t.at, 1)), "system:brief-spawn", state);
    state.generated_at = closedAt;
    setRecipients(state, [{ email: `governing-body@${this.hubId}.sample.invalid`, label: this.fill(t.sent_to) }]);
    await saveProcessState(record);

    await approveBrief(state, team.id, ctxAt(publishedAt), {
      fallbackRecipients: [],
      hubLabel: this.names.HUB_NAME,
      publicBriefUrl: `${uiBaseUrl()}/brief/${record.id}`,
      // Never delivered: sample content (and a .invalid address besides).
      sendEmail: sampleDeliverySuppressed,
      finalizeSource: async (sourceId) => {
        const s = await getProcess(sourceId);
        if (!s || s.status === "finalized") return;
        let vState = s.state as unknown as VoteProcessState;
        const method = vote.getVotingMethod(vState.method ?? vote.DEFAULT_METHOD);
        const ballots = (await getBallotChoicesForProcess(s.id)).map((c) => method.parseReceipt(c));
        ({ state: vState } = await vote.finalizeVote(vState, team.id, ballots, this.voteCtx(s, publishedAt)));
        s.status = vState.status as ProcessStatus;
        s.state = vState as unknown as Record<string, unknown>;
        await saveProcessState(s);
      },
    });
    record.status = "finalized";
    state.approved_at = publishedAt;
    state.published_at = publishedAt;
    state.delivered_at = publishedAt;
    record.state = state as unknown as Record<string, unknown>;
    await saveProcessState(record);
  }

  // --- proposal -------------------------------------------------------------

  private async seedProposal(t: SampleProposal): Promise<void> {
    const author = this.user(t.by);
    const title = this.fill(t.title);
    const description = this.fill(t.description);
    const at = this.at(t.at);
    const p = await this.create(t, {
      title,
      description,
      content: { category: "idea", optional_links: [], assistant_helped: false },
    });
    await createProposal(
      { id: p.id, title, description, submitted_by: author.id, category: "idea", assistant_helped: false, closes_at: this.at(t.closes_at) },
      this.emitAt(at),
    );
    await this.stamp("proposals", { id: p.id }, at);
    let i = 0;
    for (const who of t.endorsed_by) {
      const u = this.user(who);
      const iso = this.at(t.at, 30 + i * 90);
      await supportProposal(p.id, u.id, this.emitAt(iso));
      await this.stamp("proposal_supports", { proposal_id: p.id, user_id: u.id }, iso);
      i++;
    }
    for (const c of t.comments) await this.comment(p.id, p.jurisdiction, c, "comment");
  }

  // --- deliberation ---------------------------------------------------------

  private async seedDeliberation(t: SampleDeliberation): Promise<void> {
    const author = this.user(t.by);
    const topic = this.fill(t.topic);
    const framing = this.fill(t.framing);
    const p = await this.create(t, {
      title: topic,
      description: framing,
      state: {
        topic,
        framing,
        seed_statements: t.statements.map((s) => this.fill(s)),
        duration_ms: (t.closes_at - t.at) * DAY,
      },
    });
    // What the start action does, minus Polis: the conversation is served by
    // the seed- mock layer under this id.
    const conversationId = `${SAMPLE_CONVERSATION_PREFIX}${t.key}`;
    const polisUrl = (getSettingSync(KEYS.PLUGIN_CONVERSATION_POLIS_URL) ?? "").replace(/\/+$/, "");
    const st = p.state as Record<string, unknown>;
    st.polis_conversation_id = conversationId;
    st.polis_base_url = polisUrl ? `${polisUrl}/${conversationId}` : "";
    st.deadline = this.at(t.closes_at);
    p.status = "active";
    await saveProcessState(p);
    await this.emitAt(this.at(t.at, 1))({
      event_type: "civic.process.started",
      actor: author.id,
      process_id: p.id,
      jurisdiction: p.jurisdiction,
      processType: "civic.polis_deliberation",
      data: { process_id: p.id, process_type: "civic.polis_deliberation", polis_conversation_id: conversationId, topic },
    });
  }

  // --- project --------------------------------------------------------------

  private async seedProject(t: SampleProject): Promise<void> {
    const author = this.user(t.by);
    const title = this.fill(t.title);
    const description = this.fill(t.description);
    const at = this.at(t.at);
    const p = await this.create(t, { title, description, content: { sources: [], assistant_helped: false } });
    await createProject({ id: p.id, title, description, user_id: author.id }, this.emitAt(at));
    await this.stamp("projects", { id: p.id }, at);
    let i = 0;
    for (const who of t.supported_by) {
      const u = this.user(who);
      const iso = this.at(t.at + 1 + i);
      await setProjectSentiment(p.id, u.id, "support", this.emitAt(iso));
      await this.stamp("project_sentiments", { project_id: p.id, user_id: u.id }, iso);
      i++;
    }
    for (const c of t.comments) await this.comment(p.id, p.jurisdiction, c, "comment");
    for (const u of t.updates) {
      const iso = this.at(u.at);
      const updateId = await this.comment(p.id, p.jurisdiction, { by: t.by, body: u.body, at: u.at }, "update");
      await emitProjectUpdated({ project_id: p.id, emit: this.emitAt(iso) }, author.id, { update_id: updateId });
    }
  }

  // --- announcement ---------------------------------------------------------

  private async seedAnnouncement(t: SampleAnnouncement): Promise<void> {
    const author = this.user(t.by);
    const title = this.fill(t.title);
    const body = this.fill(t.body);
    // The hand-authored path without its publication receipt: there is no
    // human author to warn.
    const record = await this.create(t, {
      title,
      description: body,
      state: {
        title,
        body,
        author_id: author.id,
        author_role: "Admin",
        official_type: null,
        author_display_name: author.name,
        links: [],
        image_url: null,
        image_alt: null,
      },
    });
    const state = record.state as unknown as AnnouncementProcessState;
    await emitAnnouncementResultPublished(
      { process_id: record.id, jurisdiction: record.jurisdiction, emit: this.emitAt(this.at(t.at, 1)) },
      author.id,
      state,
      { timestamp: this.at(t.at, 1) },
    );
    record.status = "finalized";
    await saveProcessState(record);
  }

  async seed(t: SampleTemplate): Promise<void> {
    switch (t.kind) {
      case "vote":
        return this.seedVote(t);
      case "outcome":
        return this.seedOutcome(t);
      case "proposal":
        return this.seedProposal(t);
      case "deliberation":
        return this.seedDeliberation(t);
      case "project":
        return this.seedProject(t);
      case "announcement":
        return this.seedAnnouncement(t);
    }
  }
}
