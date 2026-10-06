// Plugins — every plugin's on/off switch, and beneath each one the settings
// that plugin has (Adam, 2026-09-24; the per-plugin settings were decided on
// 2026-09-22).
//
// Off means, for this hub only: the plugin's pages and nav items are gone,
// its routes answer "not found", its scheduled job is skipped, and its kind
// of process cannot be created. Nothing is deleted, so switching it back on
// restores everything as it was.
//
// Each plugin with a scheduled job shows the job's last run beneath its switch
// (2026-09-29): when it ran, what it produced, and any error — plus the most
// recent problem when a clean run has since replaced it as "last". The same
// failures reach the admin digest. Source: job_runs, via GET /admin/hub/jobs/runs.
//
// A setting another section already owns is shown here read-only with a link
// to where it is changed — one writer per key, so the two can never drift:
// announcement authors and brief recipients (Officials), the support
// threshold and comment anonymity (Participation).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SectionForm, { type FormApi } from "./SectionForm";
import {
  BooleanField,
  ChoiceField,
  DateField,
  HourField,
  NumberField,
  ProcessField,
  TextAreaField,
  TextField,
  UrlField,
} from "./fields";
import { PLUGIN_SECTION_ORDER } from "../../../../src/shared/hubSettingsSections";
import {
  adminGetJobRuns,
  adminGetPluginLiveCounts,
  adminGetSettings,
  type CommentIdentityMode,
  type JobRunRecord,
  type JobRunsEntry,
} from "../../services/api";

type PluginId = (typeof PLUGIN_SECTION_ORDER)[number];

const PLUGINS: Record<PluginId, { name: string; what: string }> = {
  vote: { name: "Votes", what: "Advisory votes residents propose and cast, with results." },
  proposal: { name: "Proposals", what: "Ideas residents float for discussion and support." },
  project: { name: "Projects", what: "Community projects with updates, comments and sentiment." },
  conversation: { name: "Conversations", what: "Structured group conversations that map where people agree." },
  wordcloud: { name: "Word clouds", what: "One-word answers gathered into a cloud." },
  brief: { name: "Briefs", what: "The published record of what residents decided, sent to officials." },
  announcement: { name: "Announcements", what: "Posts from officials and admins on the feed." },
  meeting_summary: { name: "Meeting summaries", what: "Plain-language summaries of public meetings, drafted for admin review." },
  news_sync: { name: "News sync", what: "Posts from your government's own news feed, copied in as announcements." },
  assistant: { name: "Writing assistant", what: "AI help while drafting a vote, proposal, project or conversation." },
  search: { name: "Search", what: "Full-text search across everything on the hub." },
  feedback: { name: "Feedback", what: "A form for residents to report problems or suggest changes." },
  digest: { name: "Resident digest", what: "A summary email of new activity to each resident who has not unsubscribed." },
  admin_digest: { name: "Admin digest", what: "A daily email to admins of what is waiting for review." },
};

const MEETING_CONNECTOR_LABELS: Record<string, string> = {
  auto: "Automatic (try each source below)",
  "wix-cms": "Wix site collection",
  "minutes-page": "Agendas & minutes page",
  "youtube-channel": "YouTube channel",
};

const NEWS_CONNECTOR_LABELS: Record<string, string> = {
  "wix-cms": "Wix blog feed",
};

const IDENTITY_MODE_LABELS: Record<CommentIdentityMode, string> = {
  real_name: "Real names on every comment",
  anonymous_optional: "Residents may choose to comment anonymously",
  anonymous_only: "Every comment is anonymous",
};

// Plugins whose items close at a deadline. The close runs when the item is
// read, and reads skip a switched-off plugin, so while one of these is off
// nothing of it closes (Phase 5 part one, step 0.4).
const HAS_DEADLINES: ReadonlySet<PluginId> = new Set(["vote", "proposal", "conversation"]);

export default function PluginsSection() {
  // Live items per plugin, loaded once. A failed load shows no warning
  // rather than a wrong number; the switch still works.
  const [live, setLive] = useState<Record<string, number>>({});
  useEffect(() => {
    adminGetPluginLiveCounts()
      .then((r) => setLive(r.counts))
      .catch(() => setLive({}));
  }, []);
  // Each job's last run. A failed load says so on the cards rather than
  // showing nothing, which would read as "never ran".
  const [jobs, setJobs] = useState<JobRunsEntry[] | "error" | null>(null);
  useEffect(() => {
    adminGetJobRuns()
      .then((r) => setJobs(r.jobs))
      .catch(() => setJobs("error"));
  }, []);

  return (
    <SectionForm
      section="plugins"
      title="Plugins"
      intro={
        <p className="form-hint">
          Switch off anything this hub does not use. A plugin that is off
          disappears from this hub's pages and menus, its scheduled job stops,
          and nothing new of its kind can be created. Nothing is deleted:
          switching it back on brings everything back as it was.
        </p>
      }
    >
      {(f) => (
        <div className="plugins-list">
          {PLUGIN_SECTION_ORDER.map((id) => (
            <PluginCard
              key={id}
              f={f}
              id={id}
              live={live[id] ?? 0}
              jobs={jobs === "error" || jobs === null ? jobs : jobs.filter((j) => j.plugin === id)}
            />
          ))}
        </div>
      )}
    </SectionForm>
  );
}

function PluginCard({
  f,
  id,
  live,
  jobs,
}: {
  f: FormApi;
  id: PluginId;
  live: number;
  jobs: JobRunsEntry[] | "error" | null;
}) {
  const on = f.value(`plugin.${id}.enabled`) === "true";
  const panel = settingsPanel(f, id);
  return (
    <section className={`plugin-card${on ? "" : " plugin-card-off"}`} aria-label={PLUGINS[id].name}>
      <BooleanField f={f} k={`plugin.${id}.enabled`} label={PLUGINS[id].name} hint={PLUGINS[id].what} />
      {on && <JobRunLines jobs={jobs} plugin={id} />}
      {!on && live > 0 && <LiveItemsWarning id={id} live={live} />}
      {panel && on && <div className="plugin-settings">{panel}</div>}
      {panel && !on && (
        <p className="form-hint plugin-off-note">
          Off. Its settings are kept and apply again when it is switched back on.
        </p>
      )}
    </section>
  );
}

// Jobs whose last run is always shown, even before the first one. Closing
// votes records only when it closed something, so it appears once it has.
const ALWAYS_SHOWN_JOBS: ReadonlySet<string> = new Set([
  "meeting_summary",
  "news_sync",
  "digest",
  "admin_digest",
]);

function JobRunLines({ jobs, plugin }: { jobs: JobRunsEntry[] | "error" | null; plugin: PluginId }) {
  if (jobs === null) return null;
  if (jobs === "error") {
    // Only on plugins that have a job; the rest have nothing to say.
    return ALWAYS_SHOWN_JOBS.has(plugin) ? (
      <p className="form-hint job-run-line">Last run: could not be loaded.</p>
    ) : null;
  }
  const shown = jobs.filter((j) => j.last || ALWAYS_SHOWN_JOBS.has(j.job_id));
  if (shown.length === 0) return null;
  return (
    <div className="job-runs">
      {shown.map((j) => (
        <JobRunLine key={j.job_id} entry={j} labelled={shown.length > 1 || j.job_id !== plugin} />
      ))}
    </div>
  );
}

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const RUN_STATUS_LABEL: Record<JobRunRecord["status"], string> = {
  ok: "OK",
  flagged: "Needs a check",
  failed: "Failed",
};

function JobRunLine({ entry, labelled }: { entry: JobRunsEntry; labelled: boolean }) {
  const { last, last_problem } = entry;
  const prefix = labelled ? `${entry.job_name}, last run` : "Last run";
  if (!last) {
    return <p className="form-hint job-run-line">{prefix}: none recorded yet.</p>;
  }
  return (
    <div className={`job-run-line job-run-${last.status}`} role={last.status === "ok" ? undefined : "status"}>
      <p className="job-run-summary">
        <span className="job-run-label">{prefix}:</span> {formatRunTime(last.finished_at)} —{" "}
        {last.summary || "completed"}{" "}
        <span className={`job-run-chip job-run-chip-${last.status}`}>{RUN_STATUS_LABEL[last.status]}</span>
      </p>
      {last.problems.length > 0 && (
        <ul className="job-run-problems">
          {last.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {/* When the last run had a problem, it is shown above; an earlier one
          is worth a line only once a clean run has replaced it as "last". */}
      {last_problem && last.status === "ok" && (
        <p className="form-hint job-run-earlier">
          Last problem, {formatRunTime(last_problem.finished_at)}: {last_problem.problems.join(" ")}
        </p>
      )}
    </div>
  );
}

function LiveItemsWarning({ id, live }: { id: PluginId; live: number }) {
  const name = PLUGINS[id].name;
  const one = live === 1;
  return (
    <p className="plugin-live-warning" role="status">
      <strong>
        {live} live {one ? "item" : "items"}.
      </strong>{" "}
      While {name} is off, {one ? "it is" : "they are"} hidden from residents
      {HAS_DEADLINES.has(id) ? (
        <>
          , and nothing closes at its deadline: anything past its closing time
          stays open until {name} is switched back on, then closes.
        </>
      ) : (
        <>; switching {name} back on shows {one ? "it" : "them"} again.</>
      )}
    </p>
  );
}

function settingsPanel(f: FormApi, id: PluginId): React.ReactNode | null {
  switch (id) {
    case "vote":
      return (
        <>
          <p className="form-hint">
            How long a resident may keep a vote open. The person drafting a vote
            picks a length within this range; a new draft starts at the default.
            Leave a box empty to keep today's value.
          </p>
          <NumberField f={f} k="plugin.vote.min_duration_days" label="Shortest voting window" unit="days" placeholder="14" />
          <NumberField f={f} k="plugin.vote.max_duration_days" label="Longest voting window" unit="days" placeholder="90" />
          <NumberField f={f} k="plugin.vote.default_duration_days" label="Default voting window" unit="days" placeholder="42" />
          <ParticipationValues show="threshold" />
          <ParticipationValues show="anonymity" />
        </>
      );
    case "proposal":
      return <ParticipationValues show="anonymity" />;
    case "conversation":
      return (
        <UrlField
          f={f}
          k="plugin.conversation.polis_url"
          label="Conversation server"
          hint="The address of the Polis server this hub's conversations run on."
        />
      );
    case "wordcloud":
      return (
        <ProcessField
          f={f}
          k="plugin.wordcloud.onboarding_id"
          label="The hub's word cloud"
          hint="Shown in the strip at the top of every page, and where a new account lands after signing up. None hides the strip."
        />
      );
    case "brief":
      return (
        <p className="form-hint">
          Who receives a brief is set under{" "}
          <Link to="/admin/settings/officials">Officials</Link> (brief recipients).
        </p>
      );
    case "announcement":
      return (
        <p className="form-hint">
          Who may post is set under <Link to="/admin/settings/officials">Officials</Link>.
          Admins can always post.
        </p>
      );
    case "meeting_summary":
      return (
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
          <TextAreaField
            f={f}
            k="plugin.meeting_summary.extraction_instructions"
            label="Extra instructions for the summarizer"
            rows={4}
            hint="Optional. Added to the standard instructions, e.g. which topics residents care about most."
          />
        </>
      );
    case "news_sync":
      return (
        <>
          <ChoiceField
            f={f}
            k="plugin.news_sync.connector"
            label="Kind of feed"
            labels={NEWS_CONNECTOR_LABELS}
            emptyLabel="Not set up"
          />
          <UrlField
            f={f}
            k="plugin.news_sync.source_url"
            label="Feed address"
            hint="Both must be set for news sync to run. Posts are created as announcements, so Announcements must be on too."
          />
        </>
      );
    case "digest":
      return (
        <HourField
          f={f}
          k="plugin.digest.send_hour"
          label="Send time"
          hint={
            <>
              In the hub's time zone, set under{" "}
              <Link to="/admin/settings/identity">Identity</Link>.
            </>
          }
        />
      );
    default:
      return null;
  }
}

/**
 * The support threshold and comment anonymity, read-only, from their one
 * writer (Participation). Loaded once per page; a failed read says so rather
 * than showing a guess.
 */
let participationCache: Promise<{ threshold: number; mode: CommentIdentityMode }> | null = null;

function ParticipationValues({ show }: { show: "threshold" | "anonymity" }) {
  const [values, setValues] = useState<{ threshold: number; mode: CommentIdentityMode } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    participationCache ??= adminGetSettings().then((s) => ({
      threshold: s.support_threshold,
      mode: s.comment_identity_mode,
    }));
    participationCache.then(setValues).catch(() => {
      participationCache = null;
      setFailed(true);
    });
  }, []);

  const label = show === "threshold" ? "Endorsements before a vote opens" : "Comment anonymity";
  const value = failed
    ? "Could not load"
    : !values
      ? "…"
      : show === "threshold"
        ? values.threshold === 0
          ? "None — approved votes open directly"
          : String(values.threshold)
        : IDENTITY_MODE_LABELS[values.mode] ?? values.mode;

  return (
    <div className="settings-field">
      <span className="form-label settings-field-label">{label}</span>
      <p className="settings-readonly">
        {value}{" "}
        <Link to="/admin/settings/participation" className="plugin-change-link">
          Change in Participation
        </Link>
      </p>
      {show === "anonymity" && (
        <p className="form-hint">Applies to comments everywhere on the hub, not only here.</p>
      )}
    </div>
  );
}
