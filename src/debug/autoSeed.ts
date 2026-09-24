// Auto-seed on startup — ensures dev scenarios are loaded.
//
// Gated behind CIVIC_ALLOW_SEED=true. Set this in your local .env. Leave it
// unset in the Vercel Production environment so production data is never
// wiped by a seed run.
//
// Seeding is idempotent per serverless instance: if processes already exist
// in the in-memory store, we skip. On cold starts with a fresh instance,
// the guard is re-entered once.

import {
  createProcess,
  executeAction,
  saveProcessState,
} from "../services/processService.js";
import { submitInput } from "../modules/civic.input/index.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getEventCount } from "../events/eventStore.js";
import { getDb } from "../db/client.js";
import {
  emitPublicationEvents as emitAnnouncementPublicationEvents,
  type AnnouncementProcessContext,
  type AnnouncementProcessState,
} from "../modules/civic.announcement/index.js";
import {
  approveMeetingSummary,
  emitCreationEvents as emitMeetingSummaryCreationEvents,
  type MeetingSummaryProcessContext,
  type MeetingSummaryProcessState,
} from "../modules/civic.meeting_summary/index.js";
import type { Process } from "../models/process.js";
import {
  FLOCK_CAMERA_VOTE,
  GREEN_BOX_VOTE,
  type SeedScenario,
} from "./seedData.js";
import {
  ATHENS_ANNOUNCEMENTS,
  ATHENS_FLOCK_CAMERA,
  ATHENS_GREEN_BOX,
  ATHENS_MEETING_SUMMARIES,
} from "./seedDataAthens.js";
import { localizeScenario } from "./localizeScenario.js";

function allowSeed(): boolean {
  return process.env.CIVIC_ALLOW_SEED === "true";
}

/**
 * Slice 19b — fixture selector. Each Vercel deployment can pick which
 * jurisdiction's seed data to load via CIVIC_SEED_FIXTURE. The default
 * set is placeless (its scenarios are filled with the seeding hub's own
 * place, governing body, and jurisdiction code via localizeScenario())
 * so production behavior is unchanged; the Athens fixture powers the
 * public demo at demo-hub.civic.social.
 *
 * Add a new fixture by exporting scenarios from a new seed-data
 * module and adding a case below — handlers should be cheap (just
 * scenario references) so adding a fixture is a one-line change.
 */
function selectScenarios(): SeedScenario[] {
  const fixture = process.env.CIVIC_SEED_FIXTURE?.trim().toLowerCase();
  switch (fixture) {
    case "athens":
      // Order matters for visual freshness in the feed (events sort
      // descending by timestamp): we seed votes first, then
      // announcements, then meeting summaries — so the feed shows the
      // ballot-driving content above the news-style content above the
      // longer-form summaries.
      return [
        ATHENS_GREEN_BOX,
        ATHENS_FLOCK_CAMERA,
        ...ATHENS_ANNOUNCEMENTS,
        ...ATHENS_MEETING_SUMMARIES,
      ];
    case "default":
    case undefined:
    case "":
      return [GREEN_BOX_VOTE, FLOCK_CAMERA_VOTE].map((s) => localizeScenario(s));
    default:
      console.warn(
        `[auto-seed] Unknown CIVIC_SEED_FIXTURE="${fixture}" — using the default set.`,
      );
      return [GREEN_BOX_VOTE, FLOCK_CAMERA_VOTE].map((s) => localizeScenario(s));
  }
}

async function runScenario(scenario: SeedScenario): Promise<void> {
  const proc = await createProcess(scenario.process);

  // Slice 19b follow-up — type-aware dispatch. The vote/proposal
  // path uses the generic action dispatcher; announcements and
  // meeting summaries publish via type-specific event helpers
  // because their lifecycles bypass the standard action flow.
  // Adding a new process type here is a one-branch change.
  const type = proc.definition.type;

  if (type === "civic.announcement") {
    await runAnnouncementSeed(proc, scenario.process.createdBy);
  } else if (type === "civic.meeting_summary") {
    await runMeetingSummarySeed(proc, scenario.process.createdBy);
  } else {
    // civic.vote / civic.proposal — generic actions + community inputs.
    for (const action of scenario.actions ?? []) {
      await executeAction(proc.id, action);
    }
    if (scenario.inputs) {
      for (const input of scenario.inputs) {
        await submitInput(proc.id, input.author_id, input.body, {
          hub_id: proc.hubId,
          jurisdiction: proc.jurisdiction,
          emit: emitEvent,
        });
      }
    }
  }

  console.log(
    `[auto-seed] Loaded: "${proc.title}" (${proc.id}) — status: ${proc.status}`,
  );
}

/**
 * Mirror the announcement controller's create+publish flow:
 * createProcess() already auto-emitted civic.process.created via
 * processService; we then fire the module's publication events
 * (which include another `created` with announcement-specific data
 * plus result_published) and finalize the process row.
 */
async function runAnnouncementSeed(
  proc: Process,
  actor: string,
): Promise<void> {
  const state = proc.state as unknown as AnnouncementProcessState;
  const ctx: AnnouncementProcessContext = {
    process_id: proc.id,
    hub_id: proc.hubId,
    jurisdiction: proc.jurisdiction,
    emit: emitEvent,
  };
  await emitAnnouncementPublicationEvents(ctx, actor, state);
  proc.status = "finalized";
  await saveProcessState(proc);
}

/**
 * Mirror the meeting-summary cron + admin-approve flow:
 * createProcess() already auto-emitted civic.process.created;
 * emitCreationEvents fires aggregation_completed; approveMeetingSummary
 * walks the state machine pending → approved → published and emits
 * outcome_recorded + result_published. Finally we finalize the row.
 *
 * Demo seed data is published immediately (not pending review) so
 * visitors see it in the feed without an admin step.
 */
async function runMeetingSummarySeed(
  proc: Process,
  actor: string,
): Promise<void> {
  const state = proc.state as unknown as MeetingSummaryProcessState;
  const ctx: MeetingSummaryProcessContext = {
    process_id: proc.id,
    hub_id: proc.hubId,
    jurisdiction: proc.jurisdiction,
    emit: emitEvent,
  };
  await emitMeetingSummaryCreationEvents(ctx, actor, state);
  await approveMeetingSummary(state, actor, ctx);
  proc.status = "finalized";
  await saveProcessState(proc);
}

// Memoize the seed run so concurrent requests don't trigger duplicate seeding.
let seedPromise: Promise<void> | null = null;

export async function seedOnStartup(): Promise<void> {
  if (!allowSeed()) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    // Skip seeding if the processes table already has data.
    const { count, error } = await getDb()
      .from("processes")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    if ((count ?? 0) > 0) {
      const evCount = await getEventCount();
      console.log(
        `[auto-seed] Skipping — ${count} process(es) and ${evCount} event(s) already present. ` +
          `Use GET /debug/seed to reset and reseed.`,
      );
      return;
    }

    const scenarios = selectScenarios();
    const fixtureName = process.env.CIVIC_SEED_FIXTURE?.trim().toLowerCase() || "default";
    console.log(`[auto-seed] Seeding initial data (fixture: ${fixtureName})...`);
    for (const scenario of scenarios) {
      await runScenario(scenario);
    }
    console.log("[auto-seed] Done\n");
  })().catch((err) => {
    console.error("[auto-seed] failed:", err);
    // Reset so a later request can retry (e.g., transient DB error)
    seedPromise = null;
    throw err;
  });

  return seedPromise;
}

/**
 * Express middleware — ensures seed data exists before handling a request.
 * No-op when CIVIC_ALLOW_SEED is unset. Safe under concurrent requests.
 */
export async function ensureSeeded(
  _req: unknown,
  _res: unknown,
  next: (err?: unknown) => void,
): Promise<void> {
  try {
    await seedOnStartup();
    next();
  } catch (err) {
    next(err);
  }
}
