import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Scheduled jobs tell the admin when they fail or produce something to check
 * (2026-09-29).
 *
 * The 2026-09-22 meeting summary came out without video timestamps and every
 * counter read clean; nobody was told. These run the real job runner, the
 * real meeting-summary run and the real admin digest end to end, with the
 * network, model, database and mail stubbed, and check two things:
 *
 *   1. a summary that comes out without timestamps is kept but NOT published
 *      — even with auto-publish on — and the run is recorded as flagged;
 *   2. a failed run is recorded, and the next admin digest names it with
 *      its reason.
 *
 * The run log (job_runs) is an in-memory stand-in for src/services/jobRuns.ts.
 */

import { FLOYD_HUB, FLOYD_SETTINGS, PLUGIN_ENV_FALLBACKS } from "../fixtures/hubs/index.js";

const FLOYD_ADMIN = "admin@floyd.example";
const SETTINGS: Record<string, Record<string, string>> = {};

interface LoggedRun {
  hub: string;
  job_id: string;
  status: string;
  summary: string;
  problems: string[];
  finished_at: string;
}
const runLog: LoggedRun[] = [];
const created: Array<Record<string, unknown>> = [];
const events: string[] = [];
const saved: Array<{ status?: string }> = [];
const mail: Array<{ to: string | string[]; subject: string; html: string }> = [];
/** Archived meeting summaries the run's dedupe reads (review M5). */
const archived: Array<Record<string, unknown>> = [];

vi.mock("../../src/db/hubs.js", () => ({
  listActiveHubs: async () => [FLOYD_HUB],
  getHubBySlug: async (slug: string) => (slug === "floyd" ? FLOYD_HUB : null),
}));

vi.mock("../../src/db/hubSettingsStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/db/hubSettingsStore.js")>()),
  fetchHubSettings: async (hubId: string) => SETTINGS[hubId] ?? {},
}));

vi.mock("../../src/services/jobRuns.js", async () => {
  const { currentHubId } = await import("../../src/config/hubContext.js");
  return {
    recordJobRun: async (
      jobId: string,
      _started: Date,
      run: { status: string; summary: string; problems: string[] },
    ) => {
      runLog.push({ hub: currentHubId(), job_id: jobId, ...run, finished_at: new Date().toISOString() });
    },
    jobProblemsSince: async (since: string) =>
      runLog
        .filter((r) => r.hub === currentHubId() && r.status !== "ok" && r.finished_at >= since)
        .map((r) => ({ ...r, started_at: r.finished_at })),
    latestJobRuns: async () => ({}),
  };
});

/** The 2026-09-22 shape: agenda + video, minutes not posted yet. */
const ENTRY = {
  meeting_title: "Regular Meeting",
  meeting_date: "2026-09-22",
  source_minutes_url: null,
  source_agenda_url: "https://county.example/_files/ugd/agenda.pdf",
  source_video_url: "https://www.youtube.com/watch?v=Dw566TkDKfk",
  additional_video_urls: [],
  source_id: "wix:2017Agenda:2026-09-22:regular-meeting",
};

vi.mock("../../src/modules/civic.meeting_summary/index.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/civic.meeting_summary/index.js")>()),
  discoverMeetings: async () => [ENTRY],
}));

vi.mock("../../src/utils/youtube.js", () => ({
  fetchYouTubeTranscript: async () => [
    { start: 31, text: "All righty." },
    { start: 420, text: "Broadband update." },
    { start: 1800, text: "Adjourn." },
  ],
}));

vi.mock("../../src/utils/http.js", () => ({
  fetchXml: async () => {
    throw new Error("stubbed: no network");
  },
  fetchHtml: async () => {
    throw new Error("stubbed: no network");
  },
  fetchJson: async () => {
    throw new Error("stubbed: no network");
  },
  fetchPdf: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf" }),
}));

// The model drops every timestamp, on the first try and on the retry.
vi.mock("../../src/utils/anthropic.js", () => ({
  DEFAULT_MODEL: "stub-model",
  callClaude: async () => ({
    model: "stub-model",
    text: JSON.stringify({
      blocks: [
        { topic_title: "Broadband", topic_summary: "An update.", start_time_seconds: null, action_taken: null },
      ],
    }),
  }),
}));

vi.mock("../../src/utils/email.js", () => ({
  sendEmail: async (input: { to: string | string[]; subject: string; html: string }) => {
    mail.push(input);
    return { sent: true, id: "stub" };
  },
}));

vi.mock("../../src/services/processService.js", () => ({
  getAllProcesses: async () => [],
  getArchivedProcesses: async () => archived,
  getSampleProcessIds: async () => new Set<string>(),
  getProcess: async () => null,
  archiveProcess: async () => undefined,
  saveProcessState: async (p: { status?: string }) => {
    saved.push({ status: p.status });
  },
  createProcess: async (input: Record<string, unknown>) => {
    created.push(input);
    return { ...input, id: `proc_${created.length}`, jurisdiction: "us-va-floyd", status: "active" };
  },
}));

vi.mock("../../src/modules/civic.review/index.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/civic.review/index.js")>()),
  listReviews: async () => [],
}));

vi.mock("../../src/events/eventEmitter.js", () => ({
  emitEvent: async (e: { event_type: string }) => {
    events.push(e.event_type);
    return {};
  },
}));

vi.mock("../../src/services/feedHealth.js", () => ({
  findBrokenPublications: async () => [],
}));

vi.mock("../../src/modules/civic.proposals/index.js", () => ({
  listProposals: async () => [],
}));

vi.mock("../../src/modules/civic.feedback/index.js", () => ({
  listFeedback: async () => [],
}));

const { jobById } = await import("../../src/jobs/registry.js");
const { JOB_RUNNERS } = await import("../../src/jobs/runners.js");
const { runJobAcrossHubs } = await import("../../src/jobs/runJob.js");

async function runJob(id: string) {
  const report = await runJobAcrossHubs(jobById(id)!, JOB_RUNNERS[id], {
    now: new Date(),
    force: false,
    onlyHub: "floyd",
  });
  if ("error" in report) throw new Error(report.error);
  await new Promise((r) => setTimeout(r, 0)); // alerts are sent after the response
  return report;
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.ANTHROPIC_API_KEY = "stub-key";
  for (const name of PLUGIN_ENV_FALLBACKS) delete process.env[name];
  SETTINGS.floyd = {
    ...FLOYD_SETTINGS,
    "people.admin_emails": JSON.stringify([FLOYD_ADMIN]),
    // Auto-publish ON: the flag must still hold the summary back.
    "plugin.meeting_summary.auto_publish": "true",
    "plugin.meeting_summary.cutoff_date": "",
  };
  runLog.length = 0;
  created.length = 0;
  events.length = 0;
  saved.length = 0;
  mail.length = 0;
  archived.length = 0;
});

describe("a missing-timestamps summary is flagged, not published", () => {
  it("keeps the summary, holds it for review, and records the run as flagged", async () => {
    await runJob("meeting_summary");

    expect(created).toHaveLength(1);
    const state = created[0].state as { quality_flag?: { kind: string; message: string } };
    expect(state.quality_flag?.kind).toBe("timestamps_missing");

    // Not published, although auto-publish is on.
    expect(events).not.toContain("civic.process.result_published");
    expect(saved.some((s) => s.status === "finalized")).toBe(false);

    const run = runLog.find((r) => r.job_id === "meeting_summary");
    expect(run?.status).toBe("flagged");
    expect(run?.problems.join(" ")).toMatch(
      /2026-09-22 Regular Meeting: No video timestamps; the transcript had timings, check before publishing/,
    );
  });
});

describe("a summary an admin deleted stays deleted (M5)", () => {
  it("does not summarize a meeting again when its summary was archived", async () => {
    // Deleting a summary archives it. getAllProcesses leaves archived rows
    // out, so before 2026-10-07 the next run found "no summary" and wrote it
    // again from the same source.
    archived.push({
      id: "proc_archived",
      definition: { type: "civic.meeting_summary", version: "0.1" },
      status: "archived",
      state: {
        source_id: ENTRY.source_id,
        source_type: "agenda",
        meeting_date: ENTRY.meeting_date,
        meeting_title: ENTRY.meeting_title,
        source_agenda_url: ENTRY.source_agenda_url,
        source_video_url: ENTRY.source_video_url,
      },
    });
    await runJob("meeting_summary");

    expect(created).toHaveLength(0);
    const run = runLog.find((r) => r.job_id === "meeting_summary");
    expect(run?.status).toBe("ok");
    expect(run?.summary).toBe("0 summaries written");
  });
});

describe("a failed run shows in the admin digest", () => {
  it("records the failure and the next admin digest names it with its reason", async () => {
    delete process.env.ANTHROPIC_API_KEY; // the meeting-summary run cannot start
    await runJob("meeting_summary");

    const failedRun = runLog.find((r) => r.job_id === "meeting_summary");
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.problems.join(" ")).toMatch(/ANTHROPIC_API_KEY must be set/);

    mail.length = 0; // drop the run's own alert; the digest is what is under test
    await runJob("admin_digest");

    const digest = mail.find((m) => m.subject.includes("Admin queue"));
    expect(digest, "the admin digest is sent for a job failure alone").toBeDefined();
    expect([digest!.to].flat()).toEqual([FLOYD_ADMIN]);
    expect(digest!.subject).toMatch(/1 scheduled job needs attention/);
    expect(digest!.html).toMatch(/Meeting summaries/);
    expect(digest!.html).toMatch(/ANTHROPIC_API_KEY must be set/);
  });

  it("stays silent about jobs when every run was clean", async () => {
    runLog.push({
      hub: "floyd",
      job_id: "news_sync",
      status: "ok",
      summary: "2 new announcements from 5 posts",
      problems: [],
      finished_at: new Date().toISOString(),
    });
    await runJob("admin_digest");
    expect(mail.filter((m) => m.subject.includes("Admin queue"))).toHaveLength(0);
  });
});
