// The Dashboard (the dashboard slice, 2026-10-17): every hub up and current,
// the jobs and the backup, what is waiting. One request gathers every
// section on the server. The Overview shows one tile per section, coloured by
// its worst problem, and "Needs a look"; each section has its own tab with
// its filters (dashboardSections.tsx). A section that timed out or failed
// says so without blanking the rest.
//
// Refreshes itself every minute while open (and when the tab comes back after
// a minute away); Refresh asks the server to skip its one-minute caches.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { when } from "./format";
import { href } from "./route";
import { SECTION_VIEWS, ago, type Concern, type SectionSummary, type Tone } from "./dashboardSections";
import type { DashboardPayload, SectionResult } from "./dashboardTypes";

const REFRESH_MS = 60_000;

interface Tab {
  id: string;
  name: string;
  tab: string;
  result: SectionResult;
  summary: SectionSummary;
}

/** A section's summary, or what a failed or unknown section says on its tile. */
function summaryOf(s: SectionResult, now: Date): SectionSummary {
  const view = SECTION_VIEWS[s.id];
  if (s.status !== "ok") {
    return { tone: "warn", value: "—", label: "", detail: s.message ?? "Could not be loaded.", concerns: [{ tone: "warn", text: `${s.name}: ${s.message ?? "could not be loaded"}` }] };
  }
  if (!view) return { tone: "quiet", value: "—", label: "", detail: "Needs a newer console.", concerns: [] };
  return view.summarize(s.data, now);
}

const TONE_ORDER: Record<Tone, number> = { danger: 0, warn: 1, ok: 2, quiet: 3 };

function TabCount({ concerns }: { concerns: Concern[] }) {
  if (concerns.length === 0) return null;
  const tone = concerns.some((c) => c.tone === "danger") ? "danger" : "warn";
  return (
    <span className={`cx-dash-tabn cx-dash-${tone}`} aria-label={`${concerns.length} to look at`}>
      {concerns.length}
    </span>
  );
}

function Overview({ tabs }: { tabs: Tab[] }) {
  const concerns = tabs
    .flatMap((t) => t.summary.concerns.map((c) => ({ ...c, tab: t })))
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  return (
    <>
      <div className="cx-dash-tiles">
        {tabs.map((t) => (
          <a
            key={t.id}
            className={`cx-dash-tile cx-dash-tile-${t.summary.tone}`}
            href={href({ name: "dashboard", tab: t.id })}
            data-testid={`dash-tile-${t.id}`}
            data-tone={t.summary.tone}
            data-status={t.result.status}
          >
            <span className="cx-dash-tile-name">{t.name}</span>
            <span className="cx-dash-tile-value">{t.summary.value}</span>
            {t.summary.label && <span className="cx-dash-tile-label">{t.summary.label}</span>}
            <span className="cx-dash-tile-detail">{t.summary.detail}</span>
          </a>
        ))}
      </div>
      <section className="cx-dash-section" aria-labelledby="dash-h-look" data-testid="dash-needs-look">
        <h2 className="cx-h2" id="dash-h-look">
          Needs a look
        </h2>
        {concerns.length === 0 ? (
          <p className="cx-dash-empty cx-muted">Nothing needs a look. Every hub is up, every job on time, nothing waiting.</p>
        ) : (
          <ul className="cx-dash-concerns">
            {concerns.map((c, i) => (
              <li key={i} className={`cx-dash-concern cx-dash-concern-${c.tone}`}>
                <a href={href({ name: "dashboard", tab: c.tab.id })}>
                  <span className="cx-dash-concern-text">{c.text}</span>
                  <span className="cx-dash-concern-where">{c.tab.tab} →</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function Dashboard({ tab }: { tab: string }) {
  const [page, setPage] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);
  const gatheredAt = useRef(0);

  const load = useCallback(async (fresh: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const p = await api.dashboard(fresh);
      setPage(p);
      gatheredAt.current = Date.parse(p.gathered_at);
      setError(null);
    } catch (e) {
      // Keep the last page on screen; say the refresh failed.
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setNow(new Date());
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(new Date());
      if (Date.now() - gatheredAt.current >= REFRESH_MS) void load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return (
    <section className="cx-dash" aria-busy={busy}>
      <div className="cx-page-head cx-dash-head">
        <div>
          <h1 className="cx-title">Dashboard</h1>
          <p className="cx-muted cx-small" data-testid="dash-gathered">
            {page ? (
              <>
                Gathered{" "}
                <time dateTime={page.gathered_at} title={when(page.gathered_at)}>
                  {ago(page.gathered_at, now)}
                </time>{" "}
                · refreshes every minute
              </>
            ) : (
              "Checking every hub…"
            )}
          </p>
        </div>
        <button type="button" className="cx-btn" onClick={() => void load(true)} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="cx-alert cx-alert-error">{page ? `Could not refresh: ${error}` : error}</p>}

      {page ? (
        <DashboardBody page={page} tab={tab} now={now} />
      ) : (
        !error && (
          <p className="cx-dash-empty cx-muted" data-testid="dash-loading">
            Asking every hub how it is. A hub that has been asleep gets a second try, so this can take up to about
            20 seconds.
          </p>
        )
      )}
    </section>
  );
}

function DashboardBody({ page, tab, now }: { page: DashboardPayload; tab: string; now: Date }) {
  const tabs: Tab[] = page.sections.map((s) => ({
    id: s.id,
    name: s.name,
    tab: SECTION_VIEWS[s.id]?.tab ?? s.name,
    result: s,
    summary: summaryOf(s, now),
  }));
  const current = tabs.find((t) => t.id === tab);
  const View = current && current.result.status === "ok" ? SECTION_VIEWS[current.id]?.render : undefined;
  return (
    <>
      <nav className="cx-dash-tabs" aria-label="Dashboard sections">
        <a href={href({ name: "dashboard" })} aria-current={!current ? "page" : undefined}>
          Overview
        </a>
        {tabs.map((t) => (
          <a key={t.id} href={href({ name: "dashboard", tab: t.id })} aria-current={current?.id === t.id ? "page" : undefined} data-testid={`dash-tab-${t.id}`}>
            {t.tab}
            <TabCount concerns={t.summary.concerns} />
          </a>
        ))}
      </nav>

      {!current ? (
        <Overview tabs={tabs} />
      ) : (
        <section
          className="cx-dash-section"
          data-testid={`dash-section-${current.id}`}
          data-status={current.result.status}
          aria-labelledby={`dash-h-${current.id}`}
        >
          <h2 className="cx-h2" id={`dash-h-${current.id}`}>
            {current.name}
          </h2>
          {current.result.status !== "ok" ? (
            <p className="cx-alert cx-alert-warn">{current.result.message}</p>
          ) : View ? (
            <View data={current.result.data} now={now} />
          ) : (
            <p className="cx-muted">This section needs a newer console. Reload the page.</p>
          )}
        </section>
      )}
    </>
  );
}
