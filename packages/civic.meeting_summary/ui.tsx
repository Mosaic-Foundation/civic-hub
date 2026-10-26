// civic.meeting_summary: a plain-language summary of a public meeting
// (manifest: ./manifest.ts).

import { AdminMeetingSummaries, MeetingSummary } from "../../ui/src/lazyPages";
import { getMeetingSummary } from "../../ui/src/services/api";
import {
  BooleanField,
  ChoiceField,
  DateField,
  NumberField,
  TextAreaField,
  TextField,
  UrlField,
} from "../../ui/src/pages/settings/pluginFields";
import { formatCount, formatDuration, formatMeetingDate } from "../../ui/src/processes/feedText";
import type { ProcessUi } from "../../ui/src/processes/types";

const MEETING_CONNECTOR_LABELS: Record<string, string> = {
  auto: "Automatic (try each source below)",
  "wix-cms": "Wix site collection",
  "minutes-page": "Agendas & minutes page",
  "youtube-channel": "YouTube channel",
};

const meetingSummaryUi: ProcessUi = {
  type: "civic.meeting_summary",
  routes: [
    { path: "/admin/meeting-summaries", element: <AdminMeetingSummaries />, admin: true },
    { path: "/admin/meeting-summaries/:id", element: <AdminMeetingSummaries />, admin: true },
    { path: "/meeting-summary/:id", element: <MeetingSummary /> },
  ],
  feed: {
    meeting: {
      card: ({ id, data, getTitle }) => {
        const ms = data.meeting_summary as
          | { meeting_title?: string; meeting_date?: string }
          | undefined;
        const meetingDate =
          ms?.meeting_date ??
          (typeof data.meeting_date === "string" ? data.meeting_date : "") ??
          "";
        const meetingTitle =
          ms?.meeting_title ??
          (typeof data.meeting_title === "string" ? data.meeting_title : undefined) ??
          getTitle(id);
        const baseTitle = meetingTitle || "Meeting summary";
        const dateStr = meetingDate ? formatMeetingDate(meetingDate) : "";
        return { title: dateStr ? `${baseTitle} — ${dateStr}` : baseTitle, summary: "" };
      },
      meta: (id) =>
        getMeetingSummary(id).then((s) => {
          // The longest start_time_seconds across all blocks gives a
          // reasonable lower bound for meeting duration; videos still
          // run past the last marked topic, so this is "at least this
          // long" rather than exact. Acceptable for the engagement line.
          const starts = (s.blocks ?? [])
            .map((b) => b.start_time_seconds)
            .filter((n): n is number => typeof n === "number");
          const maxStart = starts.length > 0 ? Math.max(...starts) : null;
          return {
            title: s.meeting_title,
            description: undefined,
            blockCount: s.blocks?.length ?? 0,
            maxStartSeconds: maxStart,
          };
        }),
      engagement: (meta) => {
        const b = meta.blockCount ?? 0;
        if (b === 0) return null;
        const noun = b === 1 ? "topic" : "topics";
        const parts = [`${formatCount(b)} ${noun} covered`];
        const dur = formatDuration(meta.maxStartSeconds ?? null);
        if (dur) parts.push(dur);
        return parts.join(" · ");
      },
    },
  },
  settingsPanel: (f) => (
    <>
      <ChoiceField
        f={f}
        k="plugin.meeting_summary.connector_id"
        label="Where meetings come from"
        labels={MEETING_CONNECTOR_LABELS}
        emptyLabel="Automatic (the default)"
      />
      <UrlField
        f={f}
        k="plugin.meeting_summary.source_url"
        label="Meetings page"
        hint="Your government's agendas and minutes page."
      />
      <TextField
        f={f}
        k="plugin.meeting_summary.youtube_channel_id"
        label="YouTube channel ID"
        width={260}
        hint="For meetings published as videos. The ID starts with UC."
      />
      <TextField
        f={f}
        k="plugin.meeting_summary.title_filter"
        label="Only meetings whose title contains"
        hint="Comma-separated. Empty takes every meeting."
      />
      <TextField
        f={f}
        k="plugin.meeting_summary.type_exclude"
        label="Skip meetings whose title contains"
        hint="Comma-separated, e.g. a board this hub does not cover."
      />
      <DateField
        f={f}
        k="plugin.meeting_summary.cutoff_date"
        label="Ignore meetings before"
        hint="Empty summarizes every meeting found."
      />
      <BooleanField
        f={f}
        k="plugin.meeting_summary.auto_publish"
        label="Publish summaries without review"
        hint="Off: each summary waits for an admin under Meeting summaries."
      />
      <NumberField
        f={f}
        k="plugin.meeting_summary.record_grace_days"
        label="Wait for a meeting's record"
        unit="days"
        placeholder="14"
        hint="How long a listed meeting may wait for its minutes or transcript before the admins are told."
      />
      <NumberField
        f={f}
        k="plugin.meeting_summary.source_quiet_days"
        label="Ask for a check after no new meeting for"
        unit="days"
        placeholder="45"
        hint="Longer for a body that meets less than monthly."
      />
      <TextField
        f={f}
        k="plugin.meeting_summary.wix_fields"
        label="Wix collection columns"
        hint="Only for a Wix site whose columns differ, e.g. date=meetingDate, minutes=minutesPdf. Empty uses the usual ones."
      />
      <TextAreaField
        f={f}
        k="plugin.meeting_summary.extraction_instructions"
        label="Extra instructions for the summarizer"
        rows={4}
        hint="Optional. Added to the standard instructions, e.g. which topics residents care about most."
      />
    </>
  ),
};

export default meetingSummaryUi;
