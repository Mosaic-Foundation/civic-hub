// Meeting summaries' sample content (PluginServer.samples, kernel step 4): a
// published summary written by hand, not by the summarizer: no recording, no
// minutes, no AI call. Each section has a time into the (absent) meeting so
// the page shows how a real summary reads; the page says it is a sample with
// no recording behind it. The words come from the hub's space type, in its
// vocabulary.

import type { PluginSamples, SampleKit, SampleTemplate } from "@civic-social/plugin-sdk";
import {
  approveMeetingSummary,
  buildProcessDescription,
  emitCreationEvents,
  type MeetingSummaryProcessState,
} from "./api.js";

/** What a meeting summary sample says. */
export interface MeetingSummarySample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Written, days relative to the seed. */
  readonly at: number;
  /** The meeting's title; may use the placeholders. */
  readonly meeting_title: string;
  /** Days relative to the seed. */
  readonly meeting_at: number;
  readonly published_at: number;
  readonly blocks: ReadonlyArray<{ title: string; summary: string; at_minute: number; action: string | null }>;
  /**
   * The meeting's minutes as plain text, shown on the page in place of a
   * minutes PDF (review issue #7, 2026-10-07). Paragraphs split on blank lines.
   */
  readonly minutes: string;
}

export async function seedMeetingSummarySample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  const t = template as unknown as MeetingSummarySample;
  const team = kit.author(t.by);
  const title = kit.fill(t.meeting_title);
  const meetingDate = kit.at(t.meeting_at).slice(0, 10);
  const blocks = t.blocks.map((b) => ({
    topic_title: kit.fill(b.title),
    topic_summary: kit.fill(b.summary),
    start_time_seconds: b.at_minute * 60,
    action_taken: b.action ? kit.fill(b.action) : null,
  }));
  // The pipeline's shape (the meeting_summary job's), with no source.
  // source_type "minutes" keeps the cron's upgrade pass from ever picking it up.
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
  await emitCreationEvents(ctxAt(kit.at(t.at, 1)), team.id, state);
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

export const meetingSummarySamples: PluginSamples = {
  seed: seedMeetingSummarySample,
  title: (t) => (t as unknown as MeetingSummarySample).meeting_title,
  // A sample seeded before 2026-10-07 gets its minutes.
  repair(t, state, fill) {
    if (typeof state.sample_minutes === "string") return null;
    return { ...state, sample_minutes: fill((t as unknown as MeetingSummarySample).minutes) };
  },
};
