// The Dashboard's renderers, one per section id the server lists
// (src/control/dashboard/registry.ts). Adding a section: a loader there, a
// renderer here under the same id. A section with no renderer here is shown
// as "This section needs a newer console."

import { useState, type ReactNode } from "react";
import { ModeBadge } from "./ui";
import { when } from "./format";
import {
  ATTENTION_QUEUES,
  type AttentionData,
  type AttentionQueue,
  type HubRow,
  type HubsData,
  type JobsData,
  type OutsideData,
  type OutsideResult,
} from "./dashboardTypes";

export type SectionRenderer = (props: { data: unknown; now: Date }) => ReactNode;

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

type Tone = "ok" | "warn" | "danger" | "quiet";

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

function healthPill(h: HubRow) {
  if (!h.health) return <Pill tone="quiet">not checked</Pill>;
  if (h.health.state === "up") return <Pill tone="ok">up</Pill>;
  if (h.health.state === "degraded") return <Pill tone="warn">degraded</Pill>;
  return <Pill tone="danger">down</Pill>;
}

function HubLine({ h }: { h: HubRow }) {
  const trouble = h.health && h.health.state !== "up";
  const stale = h.commit_matches === false;
  return (
    <li
      className={`cx-dash-row${trouble ? " cx-dash-row-danger" : stale ? " cx-dash-row-warn" : ""}`}
      data-testid={`dash-hub-${h.id}`}
      data-health={h.health?.state ?? "none"}
    >
      <div className="cx-dash-row-head">
        <span className="cx-strong">{h.name}</span>
        <ModeBadge mode={h.mode} />
        {h.status !== "active" && <Pill tone="warn">{h.status}</Pill>}
        {healthPill(h)}
      </div>
      <dl className="cx-dash-facts">
        <div>
          <dt>Commit</dt>
          <dd className="cx-mono">
            {h.commit ? h.commit.slice(0, 7) : "—"}{" "}
            {h.commit_matches === true && <span className="cx-muted">current</span>}
            {h.commit_matches === false && <Pill tone="warn">not the release</Pill>}
          </dd>
        </div>
        <div>
          <dt>Members</dt>
          <dd>{h.members ?? "—"}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>
            {h.last_activity_at ? (
              <time dateTime={h.last_activity_at} title={when(h.last_activity_at)}>
                {h.days_since_activity === 0 ? "today" : `${h.days_since_activity} days ago`}
              </time>
            ) : (
              "none yet"
            )}
          </dd>
        </div>
        {h.health && h.health.state !== "up" && (
          <div className="cx-dash-wide">
            <dt>Why</dt>
            <dd>
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
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

const HubsSectionView: SectionRenderer = ({ data }) => {
  const { hubs } = data as HubsData;
  const [showArchived, setShowArchived] = useState(false);
  const inService = hubs.filter((h) => h.group !== "archived");
  const archived = hubs.filter((h) => h.group === "archived");
  const down = inService.filter((h) => h.health && h.health.state !== "up").length;
  return (
    <>
      <p className="cx-dash-summary">
        {down === 0 ? (
          <Pill tone="ok">all {inService.length} up</Pill>
        ) : (
          <Pill tone="danger">
            {down} of {inService.length} not up
          </Pill>
        )}
      </p>
      <ul className="cx-dash-rows">
        {inService.map((h) => (
          <HubLine key={h.id} h={h} />
        ))}
      </ul>
      {archived.length > 0 && (
        <details className="cx-details cx-dash-archived" open={showArchived} onToggle={(e) => setShowArchived(e.currentTarget.open)}>
          <summary>
            Archived <span className="cx-muted">{archived.length}</span>
          </summary>
          <ul className="cx-dash-rows">
            {archived.map((h) => (
              <HubLine key={h.id} h={h} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
};

// --- Jobs and backups -------------------------------------------------------

const JobsSectionView: SectionRenderer = ({ data, now }) => {
  const { jobs, backup } = data as JobsData;
  return (
    <>
      <ul className="cx-dash-rows">
        {jobs.map((j) => (
          <li
            key={j.id}
            className={`cx-dash-row${j.attention ? " cx-dash-row-danger" : ""}`}
            data-testid={`dash-job-${j.id}`}
            data-attention={j.attention ? "yes" : "no"}
          >
            <div className="cx-dash-row-head">
              <span className="cx-strong cx-mono">{j.id}</span>
              {!j.last && <Pill tone={j.late ? "danger" : "quiet"}>never run</Pill>}
              {j.last?.status === "ok" && !j.late && <Pill tone="ok">ok</Pill>}
              {j.last?.status === "failed" && <Pill tone="danger">failed</Pill>}
              {j.last && j.late && <Pill tone="danger">late</Pill>}
            </div>
            <dl className="cx-dash-facts">
              <div>
                <dt>Last run</dt>
                <dd>{j.last ? <Stamp iso={j.last.started_at} now={now} /> : "—"}</dd>
              </div>
              <div>
                <dt>Took</dt>
                <dd>{j.last ? duration(j.last.duration_ms) : "—"}</dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>
                  {j.next_run_at ? (
                    <time dateTime={j.next_run_at} title={when(j.next_run_at)}>
                      {until(j.next_run_at, now)}
                    </time>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {j.last && j.last.hubs_failed > 0 && (
                <div>
                  <dt>Hubs failed</dt>
                  <dd>
                    {j.last.hubs_failed} of {j.last.hubs_run}
                  </dd>
                </div>
              )}
              {j.last?.error && (
                <div className="cx-dash-wide">
                  <dt>Error</dt>
                  <dd className="cx-break">{j.last.error}</dd>
                </div>
              )}
            </dl>
            <p className="cx-muted cx-small cx-dash-desc">{j.description}</p>
          </li>
        ))}
      </ul>
      <div className="cx-dash-cards">
        <OutsideCard title="Backup (database dump)" result={backup} testId="dash-backup">
          {(b) => (
            <>
              <p className="cx-dash-line">
                <Pill tone={b.status === "up" ? "ok" : b.status === "grace" || b.status === "new" ? "warn" : "danger"}>
                  {b.status}
                </Pill>
              </p>
              <p className="cx-small">
                Last dump: {b.last_ping ? <Stamp iso={b.last_ping} now={now} /> : "none yet"}
                {b.next_ping && (
                  <>
                    {" "}
                    · next {until(b.next_ping, now)}
                  </>
                )}
              </p>
            </>
          )}
        </OutsideCard>
      </div>
    </>
  );
};

// --- Uptime and errors ------------------------------------------------------

const OutsideSectionView: SectionRenderer = ({ data, now }) => {
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
};

// --- Waiting for attention ----------------------------------------------------

export const QUEUE_LABELS: Record<AttentionQueue, string> = {
  reviews: "Reviews",
  briefs: "Briefs",
  meeting_summaries: "Meeting summaries",
  feedback: "Feedback",
  waitlist: "Waitlist",
  flagged: "Flagged by checks",
};

const AttentionSectionView: SectionRenderer = ({ data }) => {
  const { hubs, feedback_days } = data as AttentionData;
  const waiting = hubs.reduce((s, h) => s + h.total, 0);
  return (
    <>
      <p className="cx-dash-summary">
        {waiting === 0 ? <Pill tone="ok">nothing waiting</Pill> : <Pill tone="warn">{waiting} waiting</Pill>}
      </p>
      <ul className="cx-dash-rows">
        {hubs.map((h) => (
          <li key={h.id} className={`cx-dash-row${h.total > 0 ? " cx-dash-row-warn" : ""}`} data-testid={`dash-attention-${h.id}`}>
            <div className="cx-dash-row-head">
              <span className="cx-strong">{h.name}</span>
              <ModeBadge mode={h.mode} />
              {h.error && <Pill tone="danger">{h.error}</Pill>}
            </div>
            <ul className="cx-dash-queues">
              {ATTENTION_QUEUES.map((q) => {
                const n = h.counts[q];
                const label = q === "feedback" ? `${QUEUE_LABELS[q]} (${feedback_days} days)` : QUEUE_LABELS[q];
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
        ))}
      </ul>
    </>
  );
};

export const SECTION_RENDERERS: Record<string, SectionRenderer> = {
  hubs: HubsSectionView,
  jobs: JobsSectionView,
  outside: OutsideSectionView,
  attention: AttentionSectionView,
};
