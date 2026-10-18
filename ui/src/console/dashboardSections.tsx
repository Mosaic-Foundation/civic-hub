// The Dashboard's views, one per section id the server lists
// (src/control/dashboard/registry.ts). Each view has:
//   - tab: the short name on its tab;
//   - summarize: the section's tile on the Overview (a tone, a headline
//     number, a line) and its concerns for "Needs a look";
//   - render: the section's own tab, with its filters.
// Adding a section: a loader there, a view here under the same id. A section
// with no view here is shown as "This section needs a newer console."

import { useState, type ReactNode } from "react";
import { ModeBadge } from "./ui";
import { when } from "./format";
import {
  ATTENTION_QUEUES,
  type AttentionData,
  type AttentionQueue,
  type AttentionRow,
  type HubRow,
  type HubsData,
  type JobRow,
  type JobsData,
  type OutsideData,
  type OutsideResult,
} from "./dashboardTypes";

export type Tone = "ok" | "warn" | "danger" | "quiet";

/** One thing on the Overview's "Needs a look" list. */
export interface Concern {
  tone: "warn" | "danger";
  text: string;
}

export interface SectionSummary {
  tone: Tone;
  /** The tile's big figure: "15/15", "3", "—". */
  value: string;
  /** What the figure counts: "hubs up". */
  label: string;
  /** One line under it. */
  detail: string;
  concerns: Concern[];
}

export interface SectionView {
  tab: string;
  summarize: (data: unknown, now: Date) => SectionSummary;
  render: (props: { data: unknown; now: Date }) => ReactNode;
}

// --- Small pieces -----------------------------------------------------------

const MINUTE = 60_000;

/** "4 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (ms < MINUTE) return "just now";
  if (ms < 60 * MINUTE) return `${Math.round(ms / MINUTE)} min ago`;
  if (ms < 48 * 60 * MINUTE) return `${Math.round(ms / (60 * MINUTE))} h ago`;
  return `${Math.round(ms / (24 * 60 * MINUTE))} days ago`;
}

/** "in 12 min", "in 5 h". */
function until(iso: string, now: Date): string {
  const ms = Date.parse(iso) - now.getTime();
  if (ms < MINUTE) return "now";
  if (ms < 60 * MINUTE) return `in ${Math.round(ms / MINUTE)} min`;
  if (ms < 48 * 60 * MINUTE) return `in ${Math.round(ms / (60 * MINUTE))} h`;
  return `in ${Math.round(ms / (24 * 60 * MINUTE))} days`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function worst(tones: Tone[]): Tone {
  if (tones.includes("danger")) return "danger";
  if (tones.includes("warn")) return "warn";
  if (tones.includes("ok")) return "ok";
  return "quiet";
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`cx-dash-pill cx-dash-${tone}`}>{children}</span>;
}

function Stamp({ iso, now }: { iso: string; now: Date }) {
  return (
    <time dateTime={iso} title={when(iso)}>
      {ago(iso, now)}
    </time>
  );
}

/** A row of filter chips; the chosen one is pressed. */
function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; text: string; count?: number; tone?: Tone }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="cx-dash-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`cx-dash-chip${o.tone && o.count ? ` cx-dash-chip-${o.tone}` : ""}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.text}
          {o.count !== undefined && <span className="cx-dash-chip-n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="cx-dash-empty cx-muted">{children}</p>;
}

/** The card for a source outside our stack (ADR-007): connected, not connected, or failing. */
function OutsideCard<T>({
  title,
  result,
  children,
  testId,
}: {
  title: string;
  result: OutsideResult<T>;
  children: (data: T) => ReactNode;
  testId: string;
}) {
  return (
    <div className="cx-card cx-dash-card" data-testid={testId} data-state={result.state}>
      <h3 className="cx-dash-card-title">{title}</h3>
      {result.state === "connected" && children(result.data)}
      {result.state === "not_connected" && (
        <>
          <p className="cx-dash-line">
            <Pill tone="quiet">not connected</Pill>
          </p>
          <p className="cx-muted cx-small">{result.setup}</p>
        </>
      )}
      {result.state === "error" && (
        <p className="cx-dash-line">
          <Pill tone="danger">could not read</Pill> <span className="cx-muted cx-small">{result.message}</span>
        </p>
      )}
    </div>
  );
}

// --- Hubs -------------------------------------------------------------------

/**
 * A hub's own tone: down or degraded is red; slow or not on the release is
 * amber. Suspended is the operator's own choice: labelled, not a warning.
 */
function hubTone(h: HubRow): Tone {
  if (h.group === "archived") return "quiet";
  if (h.health?.state === "down" || h.health?.state === "degraded") return "danger";
  if (h.health?.state === "slow" || h.commit_matches === false) return "warn";
  return "ok";
}

function healthPill(h: HubRow) {
  if (!h.health) return <Pill tone="quiet">not checked</Pill>;
  if (h.health.state === "up") return <Pill tone="ok">up</Pill>;
  if (h.health.state === "slow") return <Pill tone="warn">slow · {duration(h.health.ms)}</Pill>;
  if (h.health.state === "degraded") return <Pill tone="danger">degraded</Pill>;
  return <Pill tone="danger">down</Pill>;
}

function HubLine({ h }: { h: HubRow }) {
  const tone = hubTone(h);
  return (
    <li className={`cx-dash-row cx-dash-hubrow cx-dash-row-${tone}`} data-testid={`dash-hub-${h.id}`} data-health={h.health?.state ?? "none"}>
      <div className="cx-dash-hubname">
        <span className="cx-strong">{h.name}</span>
        <ModeBadge mode={h.mode} />
        {h.status !== "active" && <Pill tone="quiet">{h.status}</Pill>}
      </div>
      <div className="cx-dash-cell" data-label="Health">
        {healthPill(h)}
      </div>
      <div className="cx-dash-cell cx-mono" data-label="Commit">
        {h.commit ? h.commit.slice(0, 7) : "—"}{" "}
        {h.commit_matches === true && <span className="cx-muted">current</span>}
        {h.commit_matches === false && <Pill tone="warn">not the release</Pill>}
      </div>
      <div className="cx-dash-cell" data-label="Members">
        {h.members ?? "—"}
      </div>
      <div className="cx-dash-cell" data-label="Last activity">
        {h.last_activity_at ? (
          <time dateTime={h.last_activity_at} title={when(h.last_activity_at)}>
            {h.days_since_activity === 0 ? "today" : `${h.days_since_activity} days ago`}
          </time>
        ) : (
          "none yet"
        )}
      </div>
      {h.health && h.health.state !== "up" && (
        <div className="cx-dash-why">
          {h.health.reason}
          {h.health.gaps.length > 0 && (
            <ul className="cx-dash-gaps">
              {h.health.gaps.map((g) => (
                <li key={g} className="cx-mono">
                  {g}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

type HubFilter = "all" | "problems" | "live" | "beta" | "demo" | "archived";

function HubsView({ data }: { data: unknown }) {
  const { hubs } = data as HubsData;
  const inService = hubs.filter((h) => h.group !== "archived");
  const problems = inService.filter((h) => hubTone(h) !== "ok");
  const [filter, setFilter] = useState<HubFilter>(problems.length > 0 ? "problems" : "all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = (
    filter === "all"
      ? inService
      : filter === "problems"
        ? problems
        : hubs.filter((h) => h.group === filter)
  ).filter((h) => !q || h.name.toLowerCase().includes(q) || h.hostname.includes(q) || h.id.includes(q));
  const count = (g: HubFilter) => hubs.filter((h) => h.group === g).length;
  return (
    <>
      <div className="cx-dash-toolbar">
        <Chips<HubFilter>
          label="Show hubs"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", text: "In service", count: inService.length },
            { id: "problems", text: "Problems", count: problems.length, tone: worst(problems.map(hubTone)) },
            { id: "live", text: "Live", count: count("live") },
            { id: "beta", text: "Beta", count: count("beta") },
            { id: "demo", text: "Demo", count: count("demo") },
            { id: "archived", text: "Archived", count: count("archived") },
          ]}
        />
        <input
          className="cx-dash-search"
          type="search"
          placeholder="Find a hub"
          aria-label="Find a hub"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <Empty>{filter === "problems" && !q ? "Every hub in service is up and on the release." : "No hub matches."}</Empty>
      ) : (
        <ul className="cx-dash-rows cx-dash-table">
          <li className="cx-dash-thead cx-dash-hubrow" aria-hidden="true">
            <span>Hub</span>
            <span>Health</span>
            <span>Commit</span>
            <span>Members</span>
            <span>Last activity</span>
          </li>
          {shown.map((h) => (
            <HubLine key={h.id} h={h} />
          ))}
        </ul>
      )}
    </>
  );
}

function summarizeHubs(data: unknown): SectionSummary {
  const { hubs } = data as HubsData;
  const inService = hubs.filter((h) => h.group !== "archived");
  const up = inService.filter((h) => h.health?.state === "up" || h.health?.state === "slow").length;
  const concerns: Concern[] = [];
  for (const h of inService) {
    const s = h.health?.state;
    if (s === "down") concerns.push({ tone: "danger", text: `${h.name} is down: ${h.health?.reason ?? "no answer"}` });
    else if (s === "degraded") concerns.push({ tone: "danger", text: `${h.name} is degraded: ${h.health?.reason ?? ""}` });
    else if (s === "slow") concerns.push({ tone: "warn", text: `${h.name} was slow to answer (${duration(h.health!.ms)})` });
    if (h.commit_matches === false) concerns.push({ tone: "warn", text: `${h.name} is not on the release` });
  }
  const down = inService.length - up;
  const slow = inService.filter((h) => h.health?.state === "slow").length;
  return {
    tone: worst(inService.map(hubTone)),
    value: `${up}/${inService.length}`,
    label: "hubs up",
    detail: down > 0 ? `${down} not up` : slow > 0 ? `${slow} slow to answer` : "All answering",
    concerns,
  };
}

// --- Jobs and backups -------------------------------------------------------

function jobTone(j: JobRow): Tone {
  if (j.last?.status === "failed" || (j.last && j.late)) return "danger";
  if (!j.last && j.late) return "warn";
  return "ok";
}

function JobLine({ j, now }: { j: JobRow; now: Date }) {
  const tone = jobTone(j);
  return (
    <li className={`cx-dash-row cx-dash-jobrow cx-dash-row-${tone}`} data-testid={`dash-job-${j.id}`} data-attention={j.attention ? "yes" : "no"}>
      <div className="cx-dash-hubname">
        <span className="cx-strong cx-mono">{j.id}</span>
        {!j.last && <Pill tone={j.late ? "warn" : "quiet"}>never run</Pill>}
        {j.last?.status === "ok" && !j.late && <Pill tone="ok">ok</Pill>}
        {j.last?.status === "failed" && <Pill tone="danger">failed</Pill>}
        {j.last && j.late && <Pill tone="danger">late</Pill>}
      </div>
      <div className="cx-dash-cell" data-label="Last run">
        {j.last ? <Stamp iso={j.last.started_at} now={now} /> : "—"}
      </div>
      <div className="cx-dash-cell" data-label="Took">
        {j.last ? duration(j.last.duration_ms) : "—"}
      </div>
      <div className="cx-dash-cell" data-label="Next">
        {j.next_run_at ? (
          <time dateTime={j.next_run_at} title={when(j.next_run_at)}>
            {until(j.next_run_at, now)}
          </time>
        ) : (
          "—"
        )}
      </div>
      <div className="cx-dash-why cx-muted cx-small">
        {j.last && j.last.hubs_failed > 0 && (
          <span className="cx-dash-danger-text">
            {j.last.hubs_failed} of {j.last.hubs_run} hubs failed.{" "}
          </span>
        )}
        {j.last?.error && <span className="cx-dash-danger-text cx-break">{j.last.error} </span>}
        {j.description}
      </div>
    </li>
  );
}

type JobFilter = "all" | "problems";

function backupTone(b: JobsData["backup"]): Tone {
  if (b.state === "not_connected") return "quiet";
  if (b.state === "error") return "warn";
  return b.data.status === "up" ? "ok" : b.data.status === "grace" || b.data.status === "new" ? "warn" : "danger";
}

function JobsView({ data, now }: { data: unknown; now: Date }) {
  const { jobs, backup } = data as JobsData;
  const problems = jobs.filter((j) => jobTone(j) !== "ok");
  const [filter, setFilter] = useState<JobFilter>(problems.length > 0 ? "problems" : "all");
  const shown = filter === "all" ? jobs : problems;
  return (
    <>
      <div className="cx-dash-cards cx-dash-cards-top">
        <OutsideCard title="Backup (database dump)" result={backup} testId="dash-backup">
          {(b) => (
            <>
              <p className="cx-dash-line">
                <Pill tone={backupTone(backup)}>{b.status}</Pill>
              </p>
              <p className="cx-small">
                Last dump: {b.last_ping ? <Stamp iso={b.last_ping} now={now} /> : "none yet"}
                {b.next_ping && <> · next {until(b.next_ping, now)}</>}
              </p>
            </>
          )}
        </OutsideCard>
      </div>
      <div className="cx-dash-toolbar">
        <Chips<JobFilter>
          label="Show jobs"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", text: "All jobs", count: jobs.length },
            { id: "problems", text: "Late or failed", count: problems.length, tone: worst(problems.map(jobTone)) },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <Empty>Every job ran on time.</Empty>
      ) : (
        <ul className="cx-dash-rows cx-dash-table">
          <li className="cx-dash-thead cx-dash-jobrow" aria-hidden="true">
            <span>Job</span>
            <span>Last run</span>
            <span>Took</span>
            <span>Next</span>
          </li>
          {shown.map((j) => (
            <JobLine key={j.id} j={j} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

function summarizeJobs(data: unknown, now: Date): SectionSummary {
  const { jobs, backup } = data as JobsData;
  const concerns: Concern[] = [];
  for (const j of jobs) {
    if (j.last?.status === "failed") concerns.push({ tone: "danger", text: `Job ${j.id} failed${j.last.error ? `: ${j.last.error}` : ""}` });
    else if (j.last && j.late) concerns.push({ tone: "danger", text: `Job ${j.id} is late` });
    else if (!j.last && j.late) concerns.push({ tone: "warn", text: `Job ${j.id} has no run recorded yet` });
  }
  const bt = backupTone(backup);
  if (bt === "danger") concerns.push({ tone: "danger", text: "The backup is late" });
  if (bt === "warn") {
    concerns.push({
      tone: "warn",
      text: backup.state === "error" ? `The backup could not be read: ${backup.message}` : "The backup is in its grace period",
    });
  }
  const onTime = jobs.filter((j) => jobTone(j) === "ok").length;
  return {
    tone: worst([...jobs.map(jobTone), bt]),
    value: `${onTime}/${jobs.length}`,
    label: "jobs on time",
    detail:
      backup.state === "connected"
        ? `Backup ${backup.data.status}${backup.data.last_ping ? `, last dump ${ago(backup.data.last_ping, now)}` : ""}`
        : backup.state === "not_connected"
          ? "Backup: not connected"
          : "Backup: could not read",
    concerns,
  };
}

// --- Uptime and errors ------------------------------------------------------

function OutsideView({ data, now }: { data: unknown; now: Date }) {
  const { uptime, errors } = data as OutsideData;
  return (
    <div className="cx-dash-cards">
      <OutsideCard title="Uptime (Better Stack)" result={uptime} testId="dash-uptime">
        {(u) => (
          <>
            <p className="cx-dash-line">
              <Pill tone={u.up === u.total ? "ok" : "danger"}>
                {u.up} of {u.total} up
              </Pill>
            </p>
            {u.monitors.some((m) => m.status !== "up") && (
              <ul className="cx-dash-mini">
                {u.monitors
                  .filter((m) => m.status !== "up")
                  .map((m) => (
                    <li key={m.name}>
                      {m.name} <Pill tone="danger">{m.status}</Pill>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </OutsideCard>
      <OutsideCard title="Errors, last 24 hours (Sentry)" result={errors} testId="dash-errors">
        {(e) => (
          <>
            <p className="cx-dash-line">
              <Pill tone={e.events === 0 ? "ok" : "warn"}>
                {e.events} {e.events === 1 ? "error" : "errors"}
              </Pill>{" "}
              <span className="cx-muted cx-small">
                in {e.issues} {e.issues === 1 ? "issue" : "issues"}
              </span>
            </p>
            {e.top.length > 0 && (
              <ul className="cx-dash-mini">
                {e.top.map((t) => (
                  <li key={t.title + (t.link ?? "")}>
                    {t.link ? (
                      <a href={t.link} target="_blank" rel="noreferrer">
                        {t.title}
                      </a>
                    ) : (
                      t.title
                    )}{" "}
                    <span className="cx-muted">
                      ×{t.count}
                      {t.last_seen && <> · {ago(t.last_seen, now)}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </OutsideCard>
    </div>
  );
}

function summarizeOutside(data: unknown): SectionSummary {
  const { uptime, errors } = data as OutsideData;
  const concerns: Concern[] = [];
  const tones: Tone[] = [];
  if (uptime.state === "connected") {
    const down = uptime.data.monitors.filter((m) => m.status !== "up");
    for (const m of down) concerns.push({ tone: "danger", text: `Better Stack: ${m.name} is ${m.status}` });
    tones.push(down.length > 0 ? "danger" : "ok");
  } else if (uptime.state === "error") {
    concerns.push({ tone: "warn", text: `Better Stack could not be read: ${uptime.message}` });
    tones.push("warn");
  }
  if (errors.state === "connected") {
    if (errors.data.events > 0) concerns.push({ tone: "warn", text: `${errors.data.events} errors in the last 24 hours (Sentry)` });
    tones.push(errors.data.events > 0 ? "warn" : "ok");
  } else if (errors.state === "error") {
    concerns.push({ tone: "warn", text: `Sentry could not be read: ${errors.message}` });
    tones.push("warn");
  }
  const connected = [uptime, errors].filter((r) => r.state === "connected").length;
  return {
    tone: worst(tones),
    value: errors.state === "connected" ? String(errors.data.events) : "—",
    label: "errors, 24 h",
    detail:
      connected === 0
        ? "Not connected"
        : uptime.state === "connected"
          ? `${uptime.data.up} of ${uptime.data.total} monitors up`
          : "Uptime: not connected",
    concerns,
  };
}

// --- Waiting for attention ----------------------------------------------------

export const QUEUE_LABELS: Record<AttentionQueue, string> = {
  reviews: "Reviews",
  briefs: "Briefs",
  meeting_summaries: "Meeting summaries",
  feedback: "Feedback",
  waitlist: "Waitlist",
  flagged: "Flagged by checks",
};

function AttentionLine({ h, feedbackDays }: { h: AttentionRow; feedbackDays: number }) {
  return (
    <li className={`cx-dash-row cx-dash-row-${h.error ? "danger" : h.total > 0 ? "warn" : "ok"}`} data-testid={`dash-attention-${h.id}`}>
      <div className="cx-dash-hubname">
        <span className="cx-strong">{h.name}</span>
        <ModeBadge mode={h.mode} />
        {h.total > 0 && <Pill tone="warn">{h.total} waiting</Pill>}
        {h.error && <Pill tone="danger">{h.error}</Pill>}
      </div>
      <ul className="cx-dash-queues">
        {ATTENTION_QUEUES.map((q) => {
          const n = h.counts[q];
          const label = q === "feedback" ? `${QUEUE_LABELS[q]} (${feedbackDays} days)` : QUEUE_LABELS[q];
          return (
            <li key={q} className={n ? "cx-dash-queue-on" : "cx-dash-queue-off"} data-queue={q}>
              {n === null ? (
                <span title="This plugin is off on this hub">
                  <span className="cx-dash-n">—</span> <span>{label}</span>
                </span>
              ) : (
                <a href={h.links[q]} target="_blank" rel="noreferrer">
                  <span className="cx-dash-n">{n}</span> <span>{label}</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

type AttentionFilter = "waiting" | "all";

function AttentionView({ data }: { data: unknown }) {
  const { hubs, feedback_days } = data as AttentionData;
  const waiting = hubs.filter((h) => h.total > 0 || h.error);
  const [filter, setFilter] = useState<AttentionFilter>(waiting.length > 0 ? "waiting" : "all");
  const shown = filter === "all" ? hubs : waiting;
  return (
    <>
      <div className="cx-dash-toolbar">
        <Chips<AttentionFilter>
          label="Show hubs"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "waiting", text: "With items", count: waiting.length, tone: "warn" },
            { id: "all", text: "All hubs", count: hubs.length },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <Empty>Nothing is waiting on any hub.</Empty>
      ) : (
        <ul className="cx-dash-rows">
          {shown.map((h) => (
            <AttentionLine key={h.id} h={h} feedbackDays={feedback_days} />
          ))}
        </ul>
      )}
    </>
  );
}

function summarizeAttention(data: unknown): SectionSummary {
  const { hubs } = data as AttentionData;
  const total = hubs.reduce((s, h) => s + h.total, 0);
  const flagged = hubs.reduce((s, h) => s + (h.counts.flagged ?? 0), 0);
  const concerns: Concern[] = [];
  for (const h of hubs) {
    if (h.error) concerns.push({ tone: "warn", text: `${h.name}: ${h.error}` });
    if (h.total === 0) continue;
    const parts = ATTENTION_QUEUES.filter((q) => q !== "flagged" && (h.counts[q] ?? 0) > 0).map(
      (q) => `${h.counts[q]} ${QUEUE_LABELS[q].toLowerCase()}`,
    );
    const flag = h.counts.flagged ? `, ${h.counts.flagged} flagged by checks` : "";
    concerns.push({ tone: "warn", text: `${h.name}: ${parts.join(", ")}${flag}` });
  }
  const withItems = hubs.filter((h) => h.total > 0).length;
  return {
    tone: total > 0 || concerns.length > 0 ? "warn" : "ok",
    value: String(total),
    label: "items waiting",
    detail:
      total === 0
        ? "Nothing waiting"
        : `On ${withItems} ${withItems === 1 ? "hub" : "hubs"}${flagged ? `, ${flagged} flagged by checks` : ""}`,
    concerns,
  };
}

export const SECTION_VIEWS: Record<string, SectionView> = {
  hubs: { tab: "Hubs", summarize: summarizeHubs, render: HubsView },
  jobs: { tab: "Jobs and backups", summarize: summarizeJobs, render: JobsView },
  outside: { tab: "Uptime and errors", summarize: summarizeOutside, render: OutsideView },
  attention: { tab: "Waiting", summarize: summarizeAttention, render: AttentionView },
};
