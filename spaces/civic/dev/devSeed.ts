// The Civic Hub's development seed (CIVIC_ALLOW_SEED only, never production;
// the kernel checks before it calls: src/debug/autoSeed.ts for a hub with no
// processes, src/controllers/debugController.ts after /debug/seed's wipe).
// Moved here from the kernel in step 3: the scenarios are civic votes,
// conversations, announcements and meeting summaries.
//
// Slice 19b: each deployment picks its fixture with CIVIC_SEED_FIXTURE. The
// default set is placeless (filled with the seeding hub's own place, governing
// body and jurisdiction by localizeScenario()); the Athens fixture powers the
// public demo at demo-hub.civic.social. Add a fixture by exporting scenarios
// from a new seed-data module and adding a case to selectScenarios().

import { env } from "../../../src/config/env.js";
import { createProcess, executeAction, saveProcessState } from "../../../src/services/processService.js";
import { submitInput } from "../../../src/modules/civic.input/index.js";
import { emitEvent } from "../../../src/events/eventEmitter.js";
import { currentHubId } from "../../../src/config/hubContext.js";
import { insertProcessRow } from "../../../src/services/processRows.js";
import type { Process } from "../../../src/models/process.js";
import type { AnnouncementProcessContext, AnnouncementProcessState } from "../../../packages/civic.announcement/api.js";
import type { MeetingSummaryProcessContext, MeetingSummaryProcessState } from "../../../packages/civic.meeting_summary/api.js";
import {
  ALL_DELIBERATION_SEEDS,
  FLOCK_CAMERA_VOTE,
  GREEN_BOX_VOTE,
  type DeliberationSeedScenario,
  type SeedScenario,
} from "./seedData.js";
import { ATHENS_ANNOUNCEMENTS, ATHENS_FLOCK_CAMERA, ATHENS_GREEN_BOX, ATHENS_MEETING_SUMMARIES } from "./seedDataAthens.js";
import { localizeScenario } from "./localizeScenario.js";

/**
 * The id a seed process gets on one hub. Scenario ids are fixed so a seed is
 * deterministic, but process ids are globally unique and every hub on a
 * deployment seeds the same scenarios. Suffixing the hub keeps each hub's
 * seed deterministic and lets two hubs seed without colliding.
 */
export function seedIdForHub(id: string, hubId: string): string {
  return `${id}_${hubId}`;
}

function selectScenarios(): SeedScenario[] {
  const fixture = env.CIVIC_SEED_FIXTURE?.trim().toLowerCase();
  switch (fixture) {
    case "athens":
      // Order matters for visual freshness in the feed (events sort
      // descending by timestamp): votes first, then announcements, then
      // meeting summaries, so the feed shows the ballot-driving content above
      // the news-style content above the longer-form summaries.
      return [ATHENS_GREEN_BOX, ATHENS_FLOCK_CAMERA, ...ATHENS_ANNOUNCEMENTS, ...ATHENS_MEETING_SUMMARIES];
    case "default":
    case undefined:
    case "":
      return [GREEN_BOX_VOTE, FLOCK_CAMERA_VOTE].map((s) => localizeScenario(s));
    default:
      console.warn(`[auto-seed] Unknown CIVIC_SEED_FIXTURE="${fixture}" — using the default set.`);
      return [GREEN_BOX_VOTE, FLOCK_CAMERA_VOTE].map((s) => localizeScenario(s));
  }
}

async function runScenario(scenario: SeedScenario, hubId: string): Promise<Process> {
  const proc = await createProcess({
    ...scenario.process,
    ...(scenario.process.id ? { id: seedIdForHub(scenario.process.id, hubId) } : {}),
  });

  // Type-aware: votes and proposals go through the generic action
  // dispatcher; announcements and meeting summaries publish through their
  // packages' event helpers, because their lifecycles bypass the action flow.
  const type = proc.definition.type;
  if (type === "civic.announcement") {
    await runAnnouncementSeed(proc, scenario.process.createdBy);
  } else if (type === "civic.meeting_summary") {
    await runMeetingSummarySeed(proc, scenario.process.createdBy);
  } else {
    for (const action of scenario.actions ?? []) {
      await executeAction(proc.id, action, "system");
    }
    for (const input of scenario.inputs ?? []) {
      await submitInput(proc.id, input.author_id, input.body, { jurisdiction: proc.jurisdiction, emit: emitEvent });
    }
  }
  return proc;
}

/**
 * The announcement controller's create and publish: createProcess() already
 * emitted civic.process.created; the package's publication events follow and
 * the row is finalized.
 */
async function runAnnouncementSeed(proc: Process, actor: string): Promise<void> {
  const state = proc.state as unknown as AnnouncementProcessState;
  const ctx: AnnouncementProcessContext = { process_id: proc.id, jurisdiction: proc.jurisdiction, emit: emitEvent };
  // Loaded on first use, never as the hub starts (ADR-017).
  const { emitPublicationEvents } = await import("../../../packages/civic.announcement/api.js");
  await emitPublicationEvents(ctx, actor, state);
  proc.status = "finalized";
  await saveProcessState(proc);
}

/**
 * The meeting-summary cron and the admin's approve, published at once (not
 * pending review) so visitors see it in the feed without an admin step.
 */
async function runMeetingSummarySeed(proc: Process, actor: string): Promise<void> {
  const state = proc.state as unknown as MeetingSummaryProcessState;
  const ctx: MeetingSummaryProcessContext = { process_id: proc.id, jurisdiction: proc.jurisdiction, emit: emitEvent };
  const { emitCreationEvents, approveMeetingSummary } = await import("../../../packages/civic.meeting_summary/api.js");
  await emitCreationEvents(ctx, actor, state);
  await approveMeetingSummary(state, actor, ctx);
  proc.status = "finalized";
  await saveProcessState(proc);
}

/**
 * A conversation written straight to the database, bypassing the action
 * dispatcher (and so Polis), so a seed has active and completed conversations
 * with fake data.
 */
async function seedDeliberation(scenario: DeliberationSeedScenario): Promise<Record<string, unknown>> {
  const { status } = scenario;
  const p = { ...scenario.process, id: seedIdForHub(scenario.process.id, currentHubId()) };
  const now = new Date().toISOString();
  // Stamped with the hub being seeded (processes are read per hub).
  await insertProcessRow({
    id: p.id,
    type: p.definition.type,
    process_version: p.definition.version,
    title: p.title,
    description: p.description,
    jurisdiction: p.jurisdiction ?? "local",
    status,
    content: null,
    state: p.state as unknown as Record<string, unknown>,
    created_by: p.createdBy,
    source_proposal_id: null,
    starts_at: null,
    ends_at: null,
    created_at: now,
    updated_at: now,
  });
  // A creation event, so it shows in the feed.
  await emitEvent({
    event_type: "civic.process.created",
    actor: p.createdBy,
    process_id: p.id,
    jurisdiction: p.jurisdiction ?? "local",
    data: { process: { type: p.definition.type, title: p.title } },
  });
  return { id: p.id, type: p.definition.type, title: p.title, status };
}

/** A hub with no processes, on its first request: the deployment's fixture. */
export async function seedEmptyHub(hubId: string): Promise<void> {
  const fixtureName = env.CIVIC_SEED_FIXTURE?.trim().toLowerCase() || "default";
  console.log(`[auto-seed] Seeding hub "${hubId}" (fixture: ${fixtureName})...`);
  for (const scenario of selectScenarios()) {
    const proc = await runScenario(scenario, hubId);
    console.log(`[auto-seed] Loaded: "${proc.title}" (${proc.id}) — status: ${proc.status}`);
  }
}

/** After /debug/seed's wipe: the two votes and the conversations, as created. */
export async function seedAfterReset(): Promise<Array<Record<string, unknown>>> {
  const hubId = currentHubId();
  const created: Array<Record<string, unknown>> = [];
  // Green Box (an active vote), Flock Camera (a proposed vote).
  for (const s of [GREEN_BOX_VOTE, FLOCK_CAMERA_VOTE]) {
    const p = await runScenario(localizeScenario(s), hubId);
    created.push({ id: p.id, type: p.definition.type, title: p.title, status: p.status });
  }
  // The conversations, without the Polis API.
  for (const scenario of ALL_DELIBERATION_SEEDS) {
    created.push(await seedDeliberation(localizeScenario(scenario)));
  }
  return created;
}
