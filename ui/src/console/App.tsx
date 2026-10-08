import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { href, useRoute } from "./route";
import SignIn from "./SignIn";
import HubList from "./HubList";
import CreateHub from "./CreateHub";
import HubDetailPage from "./HubDetail";
import AuditLog from "./AuditLog";
import Invites from "./Invites";

type Session = { email: string | null; operator_configured: boolean };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const route = useRoute();

  const load = useCallback(() => {
    api
      .session()
      .then((s) => {
        setSession(s);
        setFailed(null);
      })
      .catch((e: Error) => setFailed(e.message));
  }, []);

  useEffect(load, [load]);

  if (failed) {
    return (
      <main className="cx-center">
        <div className="cx-card cx-narrow">
          <h1 className="cx-title">Console unavailable</h1>
          <p className="cx-muted">{failed}</p>
        </div>
      </main>
    );
  }
  if (!session) return <main className="cx-center cx-muted">Loading…</main>;
  if (!session.email) return <SignIn configured={session.operator_configured} onSignedIn={load} />;

  return (
    <div className="cx-shell">
      <header className="cx-header">
        <a className="cx-brand" href={href({ name: "hubs" })}>
          Civic Social <span>console</span>
        </a>
        <nav className="cx-nav" aria-label="Console">
          <a href={href({ name: "hubs" })} aria-current={route.name === "hubs" || route.name === "hub" ? "page" : undefined}>
            Hubs
          </a>
          <a href={href({ name: "invites" })} aria-current={route.name === "invites" ? "page" : undefined}>
            Invite codes
          </a>
          <a href={href({ name: "audit" })} aria-current={route.name === "audit" ? "page" : undefined}>
            Audit log
          </a>
        </nav>
        <div className="cx-who">
          <span className="cx-muted">{session.email}</span>
          <button
            type="button"
            className="cx-btn cx-btn-quiet"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              load();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="cx-main">
        {route.name === "hubs" && <HubList />}
        {route.name === "new" && <CreateHub />}
        {route.name === "hub" && <HubDetailPage id={route.id} />}
        {route.name === "audit" && <AuditLog />}
        {route.name === "invites" && <Invites />}
      </main>
    </div>
  );
}
