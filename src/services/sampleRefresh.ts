// Keeping a demo hub's samples current (2026-10-07, session 3b; review issue
// #9; Adam's decisions, Oct 7).
//
// A sample's deadlines are fixed when it is seeded, so a demo hub goes stale:
// the open vote closes, the proposal's window ends, the conversation stops.
// A demo hub must always show an open vote, a vote gathering endorsements, an
// open proposal and an active conversation (and the closed vote with its
// published outcome, which never goes stale). So, once a day (the
// `sample_refresh` job, src/jobs/registry.ts) and when the operator presses
// "Refresh samples" on the console's hub page:
//
//   - a live sample within REFRESH_WINDOW_DAYS of its deadline, or one that
//     has already left the phase it is there to show (the endorsement vote an
//     evaluator's endorsement opened), is REPLACED: deleted with everything
//     attached (visitors' input on it too; the demo bar says so) and seeded
//     again from its template under the same id, so links to it still work;
//   - deadlines are never moved in place: that would fight the vote lifecycle
//     (close-on-read, the hourly close, its events);
//   - the closed vote and its outcome, the project, the announcements, the
//     meeting summary and the word cloud are left alone;
//   - visitors' own items (`added_in_demo`) are never touched.
//
// Demo hubs only: on beta or live it does nothing. No hub_admin_audit_log rows
// (Adam): the job's job_runs row is the record.
//
// The button also adds any template the hub does not have (a hub seeded with
// an older list), and gives an older sample meeting summary its minutes.

import { currentHub, currentHubId } from "../config/hubContext.js";
import { forHub } from "../db/forHub.js";
import { KEYS } from "../models/hubSettings.js";
import { sampleProcessId } from "../models/sampleContent.js";
import { hubKindOf } from "../shared/hubKind.js";
import { isJurisdictionType } from "../shared/jurisdictionType.js";
import { getSettingSync } from "./hubSettings.js";
import { deleteSampleProcesses } from "./sampleContent.js";
import { sampleNames } from "./sampleNames.js";
import { seedSampleContent } from "./sampleSeed.js";
import { fillSample, templatesFor, type SampleTemplate } from "./sampleTemplates.js";

/** Replace a live sample when its deadline is this close (Adam: "a few days"). */
export const REFRESH_WINDOW_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

export interface SampleRefreshReport {
  /** Set when nothing was looked at, and why. */
  skipped?: string;
  /** Template keys replaced, each with why. */
  replaced: Array<{ key: string; reason: string }>;
  /** Templates added that the hub did not have (the console button only). */
  added: string[];
  /** Sample meeting summaries given their minutes (the console button only). */
  minutes_added: string[];
}

interface LiveRow {
  id: string;
  status: string;
  state: Record<string, unknown> | null;
}

/** The live samples a demo hub must keep showing: what each is there to show. */
function liveTemplates(templates: SampleTemplate[]): SampleTemplate[] {
  return templates.filter(
    (t) =>
      (t.kind === "vote" && (t.phase === "open" || t.phase === "proposed")) ||
      t.kind === "proposal" ||
      t.kind === "deliberation",
  );
}

/**
 * Why this sample must be replaced now, or null. Pure: the row as stored, the
 * proposal's own closes_at (proposals keep it in their table), and now.
 */
export function refreshReason(
  t: SampleTemplate,
  row: LiveRow,
  proposalClosesAt: string | null,
  now: Date,
): string | null {
  const soon = now.getTime() + REFRESH_WINDOW_DAYS * DAY;
  const near = (iso: unknown): boolean => typeof iso !== "string" || new Date(iso).getTime() <= soon;
  const st = row.state ?? {};
  switch (t.kind) {
    case "vote":
      // The closed vote and its outcome are left alone.
      if (t.phase === "closed") return null;
      if (t.phase === "proposed") {
        return row.status === "proposed" ? null : `no longer gathering endorsements (${row.status})`;
      }
      if (row.status !== "active") return `no longer open (${row.status})`;
      return near(st.voting_closes_at) ? "closes within the refresh window" : null;
    case "proposal":
      if (row.status !== "active") return `no longer open (${row.status})`;
      return near(proposalClosesAt) ? "closes within the refresh window" : null;
    case "deliberation":
      if (row.status !== "active") return `no longer active (${row.status})`;
      return near(st.deadline) ? "ends within the refresh window" : null;
    default:
      return null;
  }
}

function hubTemplates(): SampleTemplate[] {
  const typeRaw = getSettingSync(KEYS.IDENTITY_JURISDICTION_TYPE);
  const kind = hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND));
  return templatesFor(isJurisdictionType(typeRaw) ? typeRaw : null, kind);
}

/**
 * Refresh this hub's samples (in the hub's scope). `addMissing` is the
 * console button: also seed any fitting template the hub lacks, and give a
 * sample meeting summary seeded before 2026-10-07 its minutes.
 */
export async function refreshSamples(opts: { now?: Date; addMissing?: boolean } = {}): Promise<SampleRefreshReport> {
  const report: SampleRefreshReport = { replaced: [], added: [], minutes_added: [] };
  const hub = currentHub();
  if (hub?.mode !== "demo") {
    report.skipped = `not a demo hub (${hub?.mode ?? "no mode"})`;
    return report;
  }
  const hubId = currentHubId();
  const db = forHub(hubId);
  const now = opts.now ?? new Date();
  const templates = hubTemplates();

  for (const t of liveTemplates(templates)) {
    const id = sampleProcessId(hubId, t.key);
    const row = await db
      .from("processes")
      .select<LiveRow & { is_sample: boolean; added_in_demo: boolean }>("id, status, state, is_sample, added_in_demo")
      .eq("id", id)
      .maybeSingle();
    // Not seeded here (or removed with the samples): the job adds nothing.
    if (!row || !row.is_sample || row.added_in_demo) continue;
    let closesAt: string | null = null;
    if (t.kind === "proposal") {
      const p = await db.from("proposals").select<{ closes_at: string | null }>("closes_at").eq("id", id).maybeSingle();
      closesAt = p?.closes_at ?? null;
    }
    const reason = refreshReason(t, row, closesAt, now);
    if (!reason) continue;
    // What it spawned goes with it (a brief or results of a vote that closed).
    const spawned = await db
      .from("processes")
      .select<{ id: string }>("id")
      .eq("is_sample", true)
      .eq("added_in_demo", false)
      .or(`state->>source_process_id.eq.${id},source_proposal_id.eq.${id}`);
    await deleteSampleProcesses([...spawned.map((s) => s.id), id]);
    await seedSampleContent({ now, only: [t.key] });
    report.replaced.push({ key: t.key, reason });
  }

  if (opts.addMissing) {
    const seeded = await seedSampleContent({ now });
    report.added = seeded.created;
    report.minutes_added = await addMissingMinutes(templates);
  }
  return report;
}

/** Sample meeting summaries seeded before they had minutes get them. */
async function addMissingMinutes(templates: SampleTemplate[]): Promise<string[]> {
  const hubId = currentHubId();
  const db = forHub(hubId);
  const names = sampleNames();
  const added: string[] = [];
  for (const t of templates) {
    if (t.kind !== "meeting_summary") continue;
    const id = sampleProcessId(hubId, t.key);
    const row = await db
      .from("processes")
      .select<{ state: Record<string, unknown> | null }>("state")
      .eq("id", id)
      .eq("is_sample", true)
      .maybeSingle();
    if (!row || typeof row.state?.sample_minutes === "string") continue;
    await db
      .from("processes")
      .update({ state: { ...(row.state ?? {}), sample_minutes: fillSample(t.minutes, names) } })
      .eq("id", id);
    added.push(t.key);
  }
  return added;
}
