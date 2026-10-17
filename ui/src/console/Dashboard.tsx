// The Dashboard (the dashboard slice, 2026-10-17): every hub up and current,
// the jobs and the backup, what is waiting. One request gathers every
// section on the server; each renders by its id (dashboardSections.tsx), and
// a section that timed out or failed says so without blanking the rest.
//
// Refreshes itself every minute while open (and when the tab comes back after
// a minute away); Refresh asks the server to skip its one-minute caches.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { when } from "./format";
import { SECTION_RENDERERS, ago } from "./dashboardSections";
import type { DashboardPayload } from "./dashboardTypes";

const REFRESH_MS = 60_000;

export default function Dashboard() {
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
              "Gathering…"
            )}
          </p>
        </div>
        <button type="button" className="cx-btn" onClick={() => void load(true)} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="cx-alert cx-alert-error">{page ? `Could not refresh: ${error}` : error}</p>}

      {page?.sections.map((s) => {
        const Render = SECTION_RENDERERS[s.id];
        return (
          <section key={s.id} className="cx-dash-section" data-testid={`dash-section-${s.id}`} data-status={s.status} aria-labelledby={`dash-h-${s.id}`}>
            <h2 className="cx-h2" id={`dash-h-${s.id}`}>
              {s.name}
            </h2>
            {s.status !== "ok" ? (
              <p className="cx-alert cx-alert-warn">{s.message}</p>
            ) : Render ? (
              <Render data={s.data} now={now} />
            ) : (
              <p className="cx-muted">This section needs a newer console. Reload the page.</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
