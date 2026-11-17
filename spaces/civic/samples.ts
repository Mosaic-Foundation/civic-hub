// The Civic Hub's curated sample content, seeded (Phase 7; kernel step 3).
// The kernel plans the run and hands each sample here, unless the plugin that
// provides its type seeds it itself (PluginServer.samples; Word clouds does).
// Contract: BUILD-PLAN-multi-tenant.md "Phase 7: Sample content for new hubs".
//
// - Real paths: votes through the civic.vote module's lifecycle, proposals,
//   projects and comments through their modules, the outcome through the
//   brief's own approve path. The kit's create marks every process as
//   sample, and the database stamps its events as sample, so none of it
//   reaches /events or a digest.
// - Nothing leaves the building: the outcome's delivery goes to a mailer that
//   logs and sends nothing, the recipient label is the hub's governing body
//   with a `.invalid` address, the conversation is served by the `seed-` mock
//   layer (no Polis), and announcements skip the publication receipt.
// - Times are relative to now (SampleKit.at): every event is stamped with its
//   planned time and the row tables get matching created_at, so the open vote
//   is open and the feed looks current.

import { randomUUID } from "node:crypto";
import { forHub, type HubDb, type TableName } from "../../src/db/forHub.js";
import { KEYS } from "../../src/models/hubSettings.js";
import type { Process, ProcessStatus } from "../../src/models/process.js";
import { getProcess } from "../../src/services/processService.js";
import { getSettingSync, getSupportThreshold } from "../../src/services/hubSettings.js";
import { sampleDeliverySuppressed } from "../../src/services/sampleContent.js";
import { sampleBallotTagsForThisHub } from "../../src/services/sampleBallotTags.js";
import { uiBaseUrl } from "../../src/utils/baseUrl.js";
import { processWireIris } from "../../src/services/processLinks.js";
import { getBallotChoicesForProcess } from "../../src/modules/civic.receipts/index.js";
import { DEFAULT_POLIS_URL } from "../../src/shared/polisUrl.js";
import type { SampleKit, SampleTemplate } from "../../src/plugins/samples.js";
import type {
  SampleAnnouncement,
  SampleDeliberation,
  SampleMeetingSummary,
  SampleOutcome,
  SampleProject,
  SampleProposal,
  SampleTemplate as CivicTemplate,
  SampleVote,
} from "../../src/services/sampleTemplates.js";
import type * as VoteService from "../../packages/civic.vote/service.js";
import type { VoteProcessState } from "../../packages/civic.vote/service.js";
import type { BriefProcessState } from "../../packages/civic.brief/api.js";
import type { AnnouncementProcessState } from "../../packages/civic.announcement/models.js";
import type { MeetingSummaryProcessState } from "../../packages/civic.meeting_summary/api.js";
import { sampleSupportThreshold } from "./sampleRules.js";

/** The prefix the deliberation controller serves from the mock layer. */
export const SAMPLE_CONVERSATION_PREFIX = "seed-sample-";

const DAY = 24 * 60 * 60 * 1000;

// The types' services, loaded on first use, never as the hub starts (ADR-017):
// a package imports the SDK by name, and the hub hands the SDK its engine only
// once the engine has loaded, before any package.
let vote: typeof VoteService;
let createProposal: typeof import("../../packages/civic.proposals/service.js").createProposal;
let supportProposal: typeof import("../../packages/civic.proposals/service.js").supportProposal;
let createProject: typeof import("../../packages/civic.projects/service.js").createProject;
let setProjectSentiment: typeof import("../../packages/civic.projects/service.js").setProjectSentiment;
let emitProjectUpdated: typeof import("../../packages/civic.projects/events.js").emitProjectUpdated;
let approveBrief: typeof import("../../packages/civic.brief/api.js").approveBrief;
let setRecipients: typeof import("../../packages/civic.brief/api.js").setRecipients;
let emitBriefAggregationCompleted: typeof import("../../packages/civic.brief/events.js").emitBriefAggregationCompleted;
let emitAnnouncementResultPublished: typeof import("../../packages/civic.announcement/events.js").emitAnnouncementResultPublished;
let approveMeetingSummary: typeof import("../../packages/civic.meeting_summary/api.js").approveMeetingSummary;
let buildProcessDescription: typeof import("../../packages/civic.meeting_summary/api.js").buildProcessDescription;
let emitMeetingSummaryCreationEvents: typeof import("../../packages/civic.meeting_summary/api.js").emitCreationEvents;

async function loadPackages(): Promise<void> {
  if (vote) return;
  vote = await import("../../packages/civic.vote/service.js");
  ({ createProposal, supportProposal } = await import("../../packages/civic.proposals/service.js"));
  ({ createProject, setProjectSentiment } = await import("../../packages/civic.projects/service.js"));
  ({ emitProjectUpdated } = await import("../../packages/civic.projects/events.js"));
  ({ approveBrief, setRecipients } = await import("../../packages/civic.brief/api.js"));
  ({ emitBriefAggregationCompleted } = await import("../../packages/civic.brief/events.js"));
  ({ emitAnnouncementResultPublished } = await import("../../packages/civic.announcement/events.js"));
  const meeting = await import("../../packages/civic.meeting_summary/api.js");
  approveMeetingSummary = meeting.approveMeetingSummary;
  buildProcessDescription = meeting.buildProcessDescription;
  emitMeetingSummaryCreationEvents = meeting.emitCreationEvents;
}

/** Seed one curated sample, by its kind. */
export async function seedCivicSample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  await loadPackages();
  const t = template as unknown as CivicTemplate;
  switch (t.kind) {
    case "vote":
      return seedVote(kit, t);
    case "outcome":
      return seedOutcome(kit, t);
    case "proposal":
      return seedProposal(kit, t);
    case "deliberation":
      return seedDeliberation(kit, t);
    case "project":
      return seedProject(kit, t);
    case "announcement":
      return seedAnnouncement(kit, t);
    case "meeting_summary":
      return seedMeetingSummary(kit, t);
    default:
      throw new Error(`no Civic Hub seeder for sample ${template.key} (${template.type})`);
  }
}

// --- helpers ----------------------------------------------------------------

function db(kit: SampleKit): HubDb {
  return forHub(kit.hubId);
}

/** Stamp a row of the type's own table with its planned time. */
async function stamp(kit: SampleKit, table: TableName, match: Record<string, string>, iso: string, column = "created_at"): Promise<void> {
  let q = db(kit).from(table).update({ [column]: iso });
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  await q;
}

// --- votes ----------------------------------------------------------------

function voteCtx(kit: SampleKit, p: Process, iso: string) {
  return { process_id: p.id, jurisdiction: p.jurisdiction, emit: kit.emitAt(iso) };
}

/** Persist the way executeAction does: status + state, and process.updated on a status change. */
async function persistVote(kit: SampleKit, p: Process, st: VoteProcessState, previous: string, iso: string, actor: string): Promise<void> {
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

/** Anonymous ballots: receipt + choice, no person and no time. */
async function ballots(kit: SampleKit, p: Process, t: SampleVote): Promise<number> {
  const pool: string[] = [];
  t.options.forEach((opt, i) => {
    for (let k = 0; k < (t.ballots?.[i] ?? 0); k++) pool.push(kit.fill(opt));
  });
  // Deterministic interleave, so the ballots do not arrive option by option.
  let seed = 7;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // No time on a ballot, sample or not (vote_records_no_time, 2026-10-10).
  const method = vote.getVotingMethod(t.method);
  // District and age tags on a demo hub only, so its closed vote shows breakdowns (sampleBallotTags.ts).
  const tags = sampleBallotTagsForThisHub(pool.length);
  const rows = pool.map((opt, i) => ({
    receipt_id: randomUUID(),
    process_id: p.id,
    choice: method.key === "approval" ? JSON.stringify([opt]) : opt,
    ...tags[i]!,
  }));
  if (rows.length) await db(kit).from("vote_records").insert(rows);
  return rows.length;
}

async function seedVote(kit: SampleKit, t: SampleVote): Promise<void> {
  const author = kit.author(t.by);
  const options = t.options.map((o) => kit.fill(o));
  const threshold = sampleSupportThreshold(await getSupportThreshold(kit.hubId), t.endorsed_by?.length ?? 0);
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
    ({ state: st } = await vote.propose(st, author.id, voteCtx(kit, p, kit.at(t.at, 1))));
    await persistVote(kit, p, st, "draft", kit.at(t.at, 1), author.id);
    let m = 2;
    for (const who of t.endorsed_by ?? []) {
      const u = kit.author(who);
      const prev = st.status;
      const iso = kit.at(t.at + m * 0.5);
      ({ state: st } = await vote.addSupport(st, u.id, voteCtx(kit, p, iso)));
      await persistVote(kit, p, st, prev, iso, u.id);
      m++;
    }
    return;
  }

  const opens = kit.at(t.opens_at ?? t.at);
  ({ state: st } = await vote.activate(st, author.id, voteCtx(kit, p, opens)));
  st.voting_opens_at = opens;
  st.voting_closes_at = kit.at(t.closes_at ?? 7);
  st.total_votes = await ballots(kit, p, t);
  await persistVote(kit, p, st, "draft", opens, author.id);

  if (t.phase === "closed") {
    // Close through the module, as the deadline close does: tally from the
    // anonymous receipts, stamped with the deadline.
    const closed = st.voting_closes_at;
    const method = vote.getVotingMethod(st.method ?? vote.DEFAULT_METHOD);
    const ballots = (await getBallotChoicesForProcess(p.id)).map((c) => method.parseReceipt(c));
    ({ state: st } = await vote.closeVote(st, "system:auto-close", ballots, voteCtx(kit, p, closed)));
    await persistVote(kit, p, st, "active", closed, "system:auto-close");
  }
}

// --- outcome --------------------------------------------------------------

async function seedOutcome(kit: SampleKit, t: SampleOutcome): Promise<void> {
  const source = await getProcess(kit.id(t.source));
  if (!source) throw new Error(`sample outcome ${t.key}: its vote ${t.source} is missing`);
  const team = kit.author(t.by);
  const closedAt = kit.at(t.at);
  const publishedAt = kit.at(t.published_at);
  const record = await kit.create({
    title: source.title,
    description: source.description,
    state: {
      source_process_id: source.id,
      source_process_type: source.definition.type,
      content: {
        title: source.title,
        headline: kit.fill(t.headline),
        summary: kit.fill(t.summary),
        sections: t.sections.map((s) => ({ heading: kit.fill(s.heading), body: kit.fill(s.body) })),
        participation_label: kit.fill(t.participation_label),
        participation_count: t.participation_count,
        comments: [],
        admin_notes: "",
        image_url: null,
        image_alt: null,
      },
    },
  });
  const state = record.state as unknown as BriefProcessState;
  const ctxAt = (iso: string) => ({ process_id: record.id, jurisdiction: record.jurisdiction, emit: kit.emitAt(iso) });
  await emitBriefAggregationCompleted(ctxAt(kit.at(t.at, 1)), "system:brief-spawn", state);
  state.generated_at = closedAt;
  setRecipients(state, [{ email: `governing-body@${kit.hubId}.sample.invalid`, label: kit.fill(t.sent_to) }]);
  await kit.save(record);

  await approveBrief(state, team.id, ctxAt(publishedAt), {
    fallbackRecipients: [],
    hubLabel: kit.fill("{HUB_NAME}"),
    publicBriefUrl: `${uiBaseUrl()}/brief/${record.id}`,
    sourceProcessIri:
      (await processWireIris([state.source_process_id])).get(state.source_process_id) ?? null,
    // Never delivered: sample content (and a .invalid address besides).
    sendEmail: sampleDeliverySuppressed,
    finalizeSource: async (sourceId) => {
      const s = await getProcess(sourceId);
      if (!s || s.status === "finalized") return;
      let vState = s.state as unknown as VoteProcessState;
      const method = vote.getVotingMethod(vState.method ?? vote.DEFAULT_METHOD);
      const ballots = (await getBallotChoicesForProcess(s.id)).map((c) => method.parseReceipt(c));
      ({ state: vState } = await vote.finalizeVote(vState, team.id, ballots, voteCtx(kit, s, publishedAt)));
      s.status = vState.status as ProcessStatus;
      s.state = vState as unknown as Record<string, unknown>;
      await kit.save(s);
    },
  });
  record.status = "finalized";
  state.approved_at = publishedAt;
  state.published_at = publishedAt;
  state.delivered_at = publishedAt;
  record.state = state as unknown as Record<string, unknown>;
  await kit.save(record);
}

// --- proposal -------------------------------------------------------------

async function seedProposal(kit: SampleKit, t: SampleProposal): Promise<void> {
  const author = kit.author(t.by);
  const title = kit.fill(t.title);
  const description = kit.fill(t.description);
  const at = kit.at(t.at);
  const p = await kit.create({
    title,
    description,
    content: { category: "idea", optional_links: [], assistant_helped: false },
  });
  await createProposal(
    { id: p.id, title, description, submitted_by: author.id, category: "idea", assistant_helped: false, closes_at: kit.at(t.closes_at) },
    kit.emitAt(at),
  );
  await stamp(kit, "proposals", { id: p.id }, at);
  let i = 0;
  for (const who of t.endorsed_by) {
    const u = kit.author(who);
    const iso = kit.at(t.at, 30 + i * 90);
    await supportProposal(p.id, u.id, kit.emitAt(iso));
    await stamp(kit, "proposal_supports", { proposal_id: p.id, user_id: u.id }, iso);
    i++;
  }
  for (const c of t.comments) await kit.comment(p, c, "comment");
}

// --- deliberation ---------------------------------------------------------

async function seedDeliberation(kit: SampleKit, t: SampleDeliberation): Promise<void> {
  const author = kit.author(t.by);
  const topic = kit.fill(t.topic);
  const framing = kit.fill(t.framing);
  const p = await kit.create({
    version: "1.0",
    title: topic,
    description: framing,
    state: {
      topic,
      framing,
      seed_statements: t.statements.map((s) => kit.fill(s)),
      duration_ms: (t.closes_at - t.at) * DAY,
    },
  });
  // What the start action does, minus Polis: the conversation is served by
  // the seed- mock layer under this id.
  const conversationId = `${SAMPLE_CONVERSATION_PREFIX}${t.key}`;
  // The same fallback as the start action (deliberationBoot.ts).
  const polisUrl = (getSettingSync(KEYS.PLUGIN_CONVERSATION_POLIS_URL) || DEFAULT_POLIS_URL).replace(/\/+$/, "");
  const st = p.state as Record<string, unknown>;
  st.polis_conversation_id = conversationId;
  st.polis_base_url = `${polisUrl}/${conversationId}`;
  st.deadline = kit.at(t.closes_at);
  p.status = "active";
  await kit.save(p);
  await kit.emitAt(kit.at(t.at, 1))({
    event_type: "civic.process.started",
    actor: author.id,
    process_id: p.id,
    jurisdiction: p.jurisdiction,
    processType: "civic.polis_deliberation",
    data: { process_id: p.id, process_type: "civic.polis_deliberation", polis_conversation_id: conversationId, topic },
  });
}

// --- project --------------------------------------------------------------

async function seedProject(kit: SampleKit, t: SampleProject): Promise<void> {
  const author = kit.author(t.by);
  const title = kit.fill(t.title);
  const description = kit.fill(t.description);
  const at = kit.at(t.at);
  const p = await kit.create({ title, description, content: { sources: [], assistant_helped: false } });
  await createProject({ id: p.id, title, description, user_id: author.id }, kit.emitAt(at));
  await stamp(kit, "projects", { id: p.id }, at);
  let i = 0;
  for (const who of t.supported_by) {
    const u = kit.author(who);
    const iso = kit.at(t.at + 1 + i);
    await setProjectSentiment(p.id, u.id, "support", kit.emitAt(iso));
    await stamp(kit, "project_sentiments", { project_id: p.id, user_id: u.id }, iso);
    i++;
  }
  for (const c of t.comments) await kit.comment(p, c, "comment");
  for (const u of t.updates) {
    const iso = kit.at(u.at);
    const updateId = await kit.comment(p, { by: t.by, body: u.body, at: u.at }, "update");
    await emitProjectUpdated({ project_id: p.id, emit: kit.emitAt(iso) }, author.id, { update_id: updateId });
  }
}

// --- announcement ---------------------------------------------------------

async function seedAnnouncement(kit: SampleKit, t: SampleAnnouncement): Promise<void> {
  const author = kit.author(t.by);
  const title = kit.fill(t.title);
  const body = kit.fill(t.body);
  // The hand-authored path without its publication receipt: there is no
  // human author to warn.
  const record = await kit.create({
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
    { process_id: record.id, jurisdiction: record.jurisdiction, emit: kit.emitAt(kit.at(t.at, 1)) },
    author.id,
    state,
    { timestamp: kit.at(t.at, 1) },
  );
  record.status = "finalized";
  await kit.save(record);
}

// --- meeting summary ------------------------------------------------------

async function seedMeetingSummary(kit: SampleKit, t: SampleMeetingSummary): Promise<void> {
  const team = kit.author(t.by);
  const title = kit.fill(t.meeting_title);
  const meetingDate = kit.at(t.meeting_at).slice(0, 10);
  const blocks = t.blocks.map((b) => ({
    topic_title: kit.fill(b.title),
    topic_summary: kit.fill(b.summary),
    start_time_seconds: b.at_minute * 60,
    action_taken: b.action ? kit.fill(b.action) : null,
  }));
  // The pipeline's shape (the meeting_summary job's), with no source:
  // no minutes, no agenda, no recording, no AI. source_type "minutes" keeps
  // the cron's upgrade pass from ever picking it up.
  const p = await kit.create({
    title: `Meeting summary: ${meetingDate}`,
    description: buildProcessDescription(blocks),
    state: {
      source_id: `sample:${kit.id(t.key)}`,
      source_minutes_url: null,
      source_agenda_url: null,
      source_type: "minutes",
      source_video_url: null,
      additional_video_urls: [],
      meeting_title: title.charAt(0).toUpperCase() + title.slice(1),
      meeting_date: meetingDate,
      blocks,
      ai_instructions_used: "",
      ai_model: "sample",
    },
  });
  const state = p.state as unknown as MeetingSummaryProcessState;
  const ctxAt = (iso: string) => ({ process_id: p.id, jurisdiction: p.jurisdiction, emit: kit.emitAt(iso) });
  await emitMeetingSummaryCreationEvents(ctxAt(kit.at(t.at, 1)), team.id, state);
  await approveMeetingSummary(state, team.id, ctxAt(kit.at(t.published_at, 2)));
  state.generated_at = kit.at(t.at, 1);
  state.approved_at = kit.at(t.published_at, 2);
  state.published_at = kit.at(t.published_at, 2);
  p.status = "finalized";
  // Read on the page in place of a minutes PDF (review issue #7). Set here:
  // the handler's initializeState keeps only the fields it knows.
  p.state = { ...(state as unknown as Record<string, unknown>), sample_minutes: kit.fill(t.minutes) };
  await kit.save(p);
}
