import { useCallback, useEffect, useState } from "react";
import { api, type AuditEntry, type HubDetail } from "./api";
import { href } from "./route";
import { useStepUp } from "./StepUp";
import { ModeBadge, StatusBadge } from "./ui";
import { when } from "./format";
import { AuditTable } from "./AuditLog";

const PLUGIN_NAMES: Record<string, string> = {
  vote: "Votes",
  proposal: "Proposals",
  project: "Projects",
  announcement: "Announcements",
  brief: "Briefs",
  meeting_summary: "Meeting summaries",
  news_sync: "News sync",
  conversation: "Conversations",
  wordcloud: "Word clouds",
  assistant: "Writing assistant",
  search: "Search",
  feedback: "Feedback",
  digest: "Resident digest",
  admin_digest: "Admin digest",
};

const PROPAGATION = "Saved. Other server instances pick it up within a minute.";

export default function HubDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<HubDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { withStepUp, dialog } = useStepUp();

  const load = useCallback(() => {
    api.hub(id).then(setDetail).catch((e: Error) => setError(e.message));
    api.audit(id).then((r) => setAudit(r.entries)).catch(() => setAudit([]));
  }, [id]);

  useEffect(load, [load]);

  // Sections remount on fresh data (they are keyed on it), so the "saved"
  // notice lives here rather than in the section that saved.
  const reload = useCallback(() => {
    setSaved(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 5000);
    return () => window.clearTimeout(t);
  }, [saved]);

  if (error && !detail) return <p className="cx-alert cx-alert-error">{error}</p>;
  if (!detail) return <p className="cx-muted">Loading…</p>;
  const { hub } = detail;

  return (
    <section>
      {dialog}
      <p className="cx-crumb">
        <a href={href({ name: "hubs" })}>Hubs</a> / <span className="cx-mono">{hub.id}</span>
      </p>
      <div className="cx-page-head">
        <div>
          <h1 className="cx-title">{hub.name}</h1>
          <p className="cx-meta">
            <StatusBadge hub={hub} /> <ModeBadge mode={hub.mode} />{" "}
            <a className="cx-mono" href={`https://${hub.hostname}`} target="_blank" rel="noreferrer">
              {hub.hostname}
            </a>
          </p>
        </div>
      </div>
      {saved && (
        <p className="cx-alert cx-alert-ok" role="status">
          {PROPAGATION}
        </p>
      )}
      {hub.archived_at && (
        <p className="cx-alert cx-alert-warn">
          Archived {when(hub.archived_at)}. It serves the "paused" page; its slug and hostname stay taken.
        </p>
      )}

      <div className="cx-grid">
        {/* Keyed on the saved values, so a reload after a save starts each
            form from what the server now holds. */}
        <ConfigSection key={JSON.stringify(detail.config)} detail={detail} onSaved={reload} withStepUp={withStepUp} />
        <PluginsSection key={JSON.stringify(detail.plugins)} detail={detail} onSaved={reload} />
        <AdminsSection detail={detail} onSaved={reload} withStepUp={withStepUp} />
        <LifecycleSection detail={detail} onSaved={reload} withStepUp={withStepUp} />
      </div>

      <section className="cx-card">
        <h2 className="cx-h2">Audit trail</h2>
        <AuditTable entries={audit} showHub={false} />
      </section>
    </section>
  );
}

type WithStepUp = ReturnType<typeof useStepUp>["withStepUp"];

function useSave(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(fn: () => Promise<unknown | null>) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result !== null) onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const note = error && (
    <p className="cx-alert cx-alert-error" role="alert">
      {error}
    </p>
  );
  return { busy, save, note };
}

function ConfigSection({ detail, onSaved, withStepUp }: { detail: HubDetail; onSaved: () => void; withStepUp: WithStepUp }) {
  const c = detail.config;
  const [form, setForm] = useState({
    name: c.name,
    hostname: c.hostname,
    jurisdiction_name: c.jurisdiction_name ?? "",
    jurisdiction_code: c.jurisdiction_code ?? "",
    governing_body: c.governing_body,
    status: c.status,
    mode: c.mode ?? "",
  });
  const { busy, save, note } = useSave(onSaved);
  const archived = Boolean(detail.hub.archived_at);
  const needsStepUp = form.hostname !== c.hostname || (form.status === "suspended" && c.status !== "suspended") || form.mode !== (c.mode ?? "");

  return (
    <form
      className="cx-card cx-form"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Record<string, unknown> = { ...form };
        if (patch.mode === "") delete patch.mode;
        save(() => withStepUp("This change", (extra) => api.updateHub(detail.hub.id, { ...patch, ...extra })));
      }}
    >
      <h2 className="cx-h2">Configuration</h2>
      <label className="cx-field">
        <span>Name</span>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <small className="cx-muted">The registry name. The hub's display name is its own setting.</small>
      </label>
      <label className="cx-field">
        <span>Hostname</span>
        <input className="cx-mono" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value.toLowerCase().trim() })} />
        <small className="cx-muted">Changing it breaks old links; the old hostname stays taken. Its DID does not change.</small>
      </label>
      <label className="cx-field">
        <span>Jurisdiction</span>
        <input value={form.jurisdiction_name} onChange={(e) => setForm({ ...form, jurisdiction_name: e.target.value })} />
      </label>
      <label className="cx-field">
        <span>Jurisdiction code</span>
        <input className="cx-mono" value={form.jurisdiction_code} onChange={(e) => setForm({ ...form, jurisdiction_code: e.target.value.toLowerCase() })} />
      </label>
      <label className="cx-field">
        <span>Governing body</span>
        <input value={form.governing_body} onChange={(e) => setForm({ ...form, governing_body: e.target.value })} />
      </label>
      <div className="cx-two">
        <label className="cx-field">
          <span>Status</span>
          <select value={form.status} disabled={archived} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">active (serving)</option>
            <option value="suspended">suspended (paused page)</option>
          </select>
        </label>
        <label className="cx-field">
          <span>Mode</span>
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            {c.mode === "demo" && <option value="demo">demo</option>}
            <option value="beta">beta</option>
            <option value="live">live</option>
          </select>
          <small className="cx-muted">A hub enters demo only at creation.</small>
        </label>
      </div>
      {note}
      <div className="cx-actions">
        {needsStepUp && <span className="cx-muted cx-small">Needs a fresh code</span>}
        <button className="cx-btn cx-btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save configuration"}
        </button>
      </div>
    </form>
  );
}

function PluginsSection({ detail, onSaved }: { detail: HubDetail; onSaved: () => void }) {
  const initial = Object.fromEntries(detail.plugins.map((p) => [p.id, p.enabled]));
  const [values, setValues] = useState<Record<string, boolean>>(initial);
  const { busy, save, note } = useSave(onSaved);
  const changed = Object.fromEntries(Object.entries(values).filter(([id, on]) => initial[id] !== on));

  return (
    <form
      className="cx-card cx-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => api.setPlugins(detail.hub.id, changed));
      }}
    >
      <h2 className="cx-h2">Plugins</h2>
      <p className="cx-muted cx-small">
        Off hides a plugin's pages and items for this hub and stops its job. Nothing is deleted. The hub's
        own admin sees how many live items a switch would hide.
      </p>
      <ul className="cx-toggles">
        {detail.plugins.map((p) => (
          <li key={p.id}>
            <label className="cx-check">
              <input
                type="checkbox"
                checked={values[p.id] ?? p.enabled}
                onChange={(e) => setValues({ ...values, [p.id]: e.target.checked })}
              />
              {PLUGIN_NAMES[p.id] ?? p.id}
            </label>
            {p.source !== "hub" && <span className="cx-muted cx-small">{p.source === "environment" ? "from env" : "default"}</span>}
          </li>
        ))}
      </ul>
      {note}
      <div className="cx-actions">
        <button className="cx-btn cx-btn-primary" disabled={busy || Object.keys(changed).length === 0}>
          {busy ? "Saving…" : "Save plugins"}
        </button>
      </div>
    </form>
  );
}

function AdminsSection({ detail, onSaved, withStepUp }: { detail: HubDetail; onSaved: () => void; withStepUp: WithStepUp }) {
  const [adding, setAdding] = useState("");
  const { busy, save, note } = useSave(onSaved);
  const admins = detail.admins;

  return (
    <section className="cx-card cx-form">
      <h2 className="cx-h2">Admins</h2>
      <p className="cx-muted cx-small">Who administers this hub from its own Settings. Removing someone needs a fresh code.</p>
      {admins.length === 0 && (
        <p className="cx-alert cx-alert-warn">
          No admin list stored for this hub, so it falls back to the deployment's CIVIC_ADMIN_EMAILS. Adding one here
          stores the list and ends the fallback.
        </p>
      )}
      <ul className="cx-list">
        {admins.map((email) => (
          <li key={email}>
            <span className="cx-break">{email}</span>
            <button
              type="button"
              className="cx-btn cx-btn-quiet cx-btn-danger"
              disabled={busy || admins.length === 1}
              title={admins.length === 1 ? "A hub needs at least one admin" : undefined}
              onClick={() =>
                save(() =>
                  withStepUp(`Removing ${email}`, (extra) =>
                    api.setAdmins(detail.hub.id, admins.filter((a) => a !== email), extra),
                  ),
                )
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="cx-inline"
        onSubmit={(e) => {
          e.preventDefault();
          const email = adding.trim().toLowerCase();
          if (!email) return;
          save(async () => {
            const r = await api.setAdmins(detail.hub.id, [...admins, email]);
            setAdding("");
            return r;
          });
        }}
      >
        <input type="email" placeholder="name@example.org" aria-label="Add an admin" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <button className="cx-btn" disabled={busy || !adding.trim()}>
          Add
        </button>
      </form>
      {note}
    </section>
  );
}

function LifecycleSection({ detail, onSaved, withStepUp }: { detail: HubDetail; onSaved: () => void; withStepUp: WithStepUp }) {
  const { busy, save, note } = useSave(onSaved);
  const { hub } = detail;
  const [confirm, setConfirm] = useState("");

  return (
    <section className="cx-card cx-form cx-danger-zone">
      <h2 className="cx-h2">Archive</h2>
      {hub.archived_at ? (
        <>
          <p className="cx-muted cx-small">
            Unarchiving clears the archive mark. The hub stays suspended until you set its status to active.
          </p>
          <div className="cx-actions">
            <button type="button" className="cx-btn" disabled={busy} onClick={() => save(() => api.unarchive(hub.id))}>
              Unarchive
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="cx-muted cx-small">
            Archiving suspends the hub (visitors see a paused page) and marks it retired. Nothing is deleted, and its
            slug and hostname can never be given to another hub. Type the slug to confirm.
          </p>
          <input
            className="cx-mono"
            aria-label="Type the slug to confirm"
            placeholder={hub.id}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="cx-actions">
            <button
              type="button"
              className="cx-btn cx-btn-danger-solid"
              disabled={busy || confirm !== hub.id}
              onClick={() => save(() => withStepUp(`Archiving ${hub.id}`, (extra) => api.archive(hub.id, extra)))}
            >
              Archive hub
            </button>
          </div>
        </>
      )}
      {note}
    </section>
  );
}
