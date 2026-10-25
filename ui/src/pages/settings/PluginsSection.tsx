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
//
// A plugin that is on but cannot do anything yet (today Meeting summaries
// and News sync, without a source) stays on and shows a "Needs setup" badge
// saying what is missing (Adam, 2026-10-07; src/shared/pluginSetup.ts).

import { useApi } from "../../hooks/useApi";
import { Link } from "react-router-dom";
import SectionForm from "./SectionForm";
import {
  BooleanField,
  ChoiceField,
  EmailField,
  HourField,
  NumberField,
  UrlField,
  type FormApi,
} from "./pluginFields";
import { PLUGIN_SECTION_ORDER } from "../../../../src/shared/hubSettingsSections";
import { useHub, type Hub } from "../../config/hub";
import { feedbackContactEmail } from "../../../../src/shared/platform";
import { pluginAnchor } from "../../../../src/shared/adminAnchors";
import { useAnchoredOpen } from "../../hooks/useAnchor";
import HelpButton from "../../components/HelpButton";
import { HUB_FEATURES } from "../../../../src/shared/hubFeatures";
import { pluginHasDeadlines, processPluginCopy } from "../../processes/display";
import { processSettingsPanel } from "../../processes";
import {
  adminGetJobRuns,
  adminGetPluginLiveCounts,
  type MemberSummary,
  getMemberSummary,
  type JobRunRecord,
  type JobRunsEntry,
} from "../../services/api";

type PluginId = (typeof PLUGIN_SECTION_ORDER)[number];

// What the Plugins page calls each plugin: a process plugin's from its
// manifest (pluginSection), a hub feature's from src/shared/hubFeatures.ts.
// The digest alone is worded from the hub's own noun (place: resident,
// organization: member, else participant, or copy.resident_noun); read at
// render, not at load.
function digestCopy(hub: Hub): { name: string; what: string } {
  return {
    name: `${hub.person_label} digest`,
    what: `A summary email of new activity to each ${hub.noun(1)} who has not unsubscribed.`,
  };
}

function pluginCopy(id: PluginId, hub: Hub): { name: string; what: string } {
  if (id === "digest") return digestCopy(hub);
  return processPluginCopy(id) ?? HUB_FEATURES.find((f) => f.id === id) ?? { name: id, what: "" };
}

const NEWS_CONNECTOR_LABELS: Record<string, string> = {
  "wix-cms": "Wix blog feed",
};

const NO_COUNTS: Record<string, number> = {};

export default function PluginsSection() {
  // Live items per plugin, loaded once. A failed load shows no warning
  // rather than a wrong number; the switch still works.
  const { data: liveRead } = useApi("admin/plugins/live-counts", () => adminGetPluginLiveCounts());
  const live: Record<string, number> = liveRead?.counts ?? NO_COUNTS;
  // Each job's last run. A failed load says so on the cards rather than
  // showing nothing, which would read as "never ran".
  const { data: jobsRead, error: jobsError } = useApi("admin/hub/jobs/runs", () => adminGetJobRuns());
  const jobs: JobRunsEntry[] | "error" | null = jobsError ? "error" : (jobsRead?.jobs ?? null);

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
  const hub = useHub();
  const on = f.value(`plugin.${id}.enabled`) === "true";
  const panel = settingsPanel(f, id);
  // From the served config, so it describes what is saved; refreshed after
  // every save (src/shared/pluginSetup.ts holds the rule).
  const setup = hub.plugins.setup(id);
  // Collapsed until clicked, or until a link names it
  // (/admin/settings/plugins#feedback; admin menu slice, 2026-10-13).
  const anchor = pluginAnchor(id);
  const [open, setOpen] = useAnchoredOpen(anchor);
  const bodyId = `plugin-${anchor}-body`;
  return (
    <section
      id={anchor}
      data-anchor=""
      className={`plugin-card${on ? "" : " plugin-card-off"}${open ? " is-open" : ""}`}
      aria-label={pluginCopy(id, hub).name}
    >
      <div className="plugin-card-top">
      <button
        type="button"
        className="plugin-card-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="plugin-card-title">
          <span className="plugin-card-name">{pluginCopy(id, hub).name}</span>
          <span className={`plugin-card-state${on ? " is-on" : ""}`}>{on ? "On" : "Off"}</span>
          {on && setup && <span className="plugin-needs-setup-chip">Needs setup</span>}
        </span>
        <span className="plugin-card-what">{pluginCopy(id, hub).what}</span>
        <svg className="plugin-card-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 5.5L7 9L10.5 5.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <span className="plugin-card-help">
        <HelpButton k={`plugins.${id}`} label={pluginCopy(id, hub).name} />
      </span>
      </div>
      {open && (
        <div id={bodyId} className="plugin-card-body">
          <BooleanField f={f} k={`plugin.${id}.enabled`} label={`${pluginCopy(id, hub).name} on`} />
          {on && setup && <NeedsSetup missing={setup.missing} shown={setup.shown} />}
          {on && <JobRunLines jobs={jobs} plugin={id} />}
          {!on && live > 0 && <LiveItemsWarning id={id} live={live} />}
          {panel && on && <div className="plugin-settings">{panel}</div>}
          {panel && !on && (
            <p className="form-hint plugin-off-note">
              Off. Its settings are kept and apply again when it is switched back on.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Switched on, but nothing to do until the admin sets it up. It stays on;
 * the public site shows it only once it has something to show.
 */
function NeedsSetup({ missing, shown }: { missing: string; shown: boolean }) {
  return (
    <p className="plugin-needs-setup" role="status">
      <span className="plugin-needs-setup-chip">Needs setup</span> {missing}
      {!shown && " Until then it is hidden from residents."}
    </p>
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
  const hub = useHub();
  const name = pluginCopy(id, hub).name;
  const one = live === 1;
  // A plugin whose items close at a deadline (any of its types has one). A read
  // never closes anything (since Architecture 2); the hourly job closes them and
  // skips a switched-off plugin, so while one of these is off nothing of it closes.
  return (
    <p className="plugin-live-warning" role="status">
      <strong>
        {live} live {one ? "item" : "items"}.
      </strong>{" "}
      While {name} is off, {one ? "it is" : "they are"} hidden from residents
      {pluginHasDeadlines(id) ? (
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

// The hub features' own panels. A process plugin's panel comes from its type's
// module (ui/src/processes/), through processSettingsPanel.
const FEATURE_PANELS: Partial<Record<PluginId, (f: FormApi) => React.ReactNode>> = {
  news_sync: (f) => (
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
  ),
  digest: (f) => (
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
  ),
  feedback: (f) => (
    <EmailField
      f={f}
      k="plugin.feedback.contact_email"
      label="Address on the Feedback page"
      placeholder={feedbackContactEmail(undefined, f.data.values["legal.contact_email"])}
      hint={
        <>
          Where the <a href="/feedback" target="_blank" rel="noreferrer">Feedback page</a> tells
          people to write if they would rather email. Left empty, it shows the contact address
          under <Link to="/admin/settings/legal">Legal</Link>, or the platform's when that is
          empty too: the address shown here.
        </>
      }
    />
  ),
  members: (f) => (
    <>
      <MemberCountLine saved={f.data.values["plugin.members.min_count"] ?? ""} />
      <NumberField
        f={f}
        k="plugin.members.min_count"
        label="Show members from"
        unit="members"
        placeholder="0"
        hint="Until the hub has this many members, residents see no member count, no faces and no Members page. Admins always see them. Empty or 0 shows them from the first member."
      />
      <BooleanField
        f={f}
        k="plugin.members.page_before_threshold"
        label="Show the Members page before then"
        hint="The page and its place in the menus appear for members now; the count on the home page still waits."
      />
    </>
  ),
};

function settingsPanel(f: FormApi, id: PluginId): React.ReactNode | null {
  return processSettingsPanel(id, f) ?? FEATURE_PANELS[id]?.(f) ?? null;
}

/**
 * How many members the hub has now, which only admins see before the
 * threshold. Read again when a save changes the threshold (`saved`).
 */
function MemberCountLine({ saved }: { saved: string }) {
  const { data: summary } = useApi<MemberSummary>("members/summary", () => getMemberSummary(), { rereadOn: saved });
  if (!summary || summary.count === null) return null;
  return (
    <p className="form-hint" data-testid="members-now">
      This hub has {summary.count.toLocaleString()} {summary.count === 1 ? "member" : "members"}
      {summary.shown === false ? "; residents don't see the count yet." : "; residents see the count."}
    </p>
  );
}
