import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AuditEntry,
  type HubAdminAuditEntry,
  type HubDetail,
  type HubExport,
  type SampleRefreshReport,
} from "./api";
import { JURISDICTION_TYPES, defaultGoverningBodyShort, hubTypeFor } from "../../../src/shared/jurisdictionType";
import { jurisdictionCodeFor } from "../../../src/shared/jurisdictionNames";
import { JurisdictionPicker, type JurisdictionChoice } from "./JurisdictionPicker";
import { HUB_KINDS } from "../../../src/shared/hubKind";
import { href } from "./route";
import { useStepUp } from "./StepUp";
import { ModeBadge, StatusBadge } from "./ui";
import { when } from "./format";
import { AuditTable } from "./AuditLog";
import { PLUGIN_NAMES } from "./pluginNames";


const PROPAGATION = "Saved. Other server instances pick it up within a minute.";

export default function HubDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<HubDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [adminAudit, setAdminAudit] = useState<HubAdminAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { withStepUp, dialog } = useStepUp();

  const load = useCallback(() => {
    api.hub(id).then(setDetail).catch((e: Error) => setError(e.message));
    api.audit(id).then((r) => setAudit(r.entries)).catch(() => setAudit([]));
    api.hubAdminAudit(id).then((r) => setAdminAudit(r.entries)).catch(() => setAdminAudit([]));
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
          Archived {when(hub.archived_at)}. It serves the "paused" page; its slug and hostname stay taken. A hub that was
          never used can be purged to free them (<code>scripts/purge-hub.ts</code>).
        </p>
      )}

      <div className="cx-grid">
        {/* Keyed on the saved values, so a reload after a save starts each
            form from what the server now holds. */}
        <ConfigSection key={JSON.stringify(detail.config)} detail={detail} onSaved={reload} withStepUp={withStepUp} />
        <PluginsSection key={JSON.stringify(detail.plugins)} detail={detail} onSaved={reload} />
        <AdminsSection detail={detail} onSaved={reload} withStepUp={withStepUp} />
        {detail.hub.mode === "demo" && !detail.hub.archived_at && <SamplesSection detail={detail} />}
        <ExportSection detail={detail} onExported={load} withStepUp={withStepUp} />
        <LifecycleSection detail={detail} onSaved={reload} withStepUp={withStepUp} />
      </div>

      <section className="cx-card">
        <h2 className="cx-h2">Audit trail</h2>
        {auditLives(audit, hub.created_at).map((life, i) => (
          <div key={i}>
            {life.label && <h3 className="cx-life">{life.label}</h3>}
            <AuditTable entries={life.entries} showHub={false} />
          </div>
        ))}
      </section>

      <section className="cx-card">
        <h2 className="cx-h2">Hub admin actions</h2>
        <p className="cx-muted cx-small">
          What this hub's own admins did with a fresh code: sample content removed, mode changes, roster changes. Kept
          in the hub's own log, which leaves with its export.
        </p>
        <AuditTable
          entries={adminAudit.map((e) => ({ ...e, target_hub_id: null }))}
          showHub={false}
        />
      </section>
    </section>
  );
}

type WithStepUp = ReturnType<typeof useStepUp>["withStepUp"];

/**
 * A slug freed by scripts/purge-hub.ts can be given to a new hub, and the
 * audit log keeps the old hub's rows under the same id. Each hub.purge row's
 * `before` is the purged hub's whole row, so the trail splits there: this
 * hub's own life first (newest first), then each earlier one, labelled.
 */
function auditLives(entries: AuditEntry[], createdAt: string): Array<{ label: string | null; entries: AuditEntry[] }> {
  const purges = entries.filter((e) => e.action === "hub.purge");
  if (purges.length === 0) return [{ label: null, entries }];
  const lives: Array<{ label: string | null; entries: AuditEntry[] }> = [
    { label: `This hub — created ${when(createdAt)}`, entries: [] },
  ];
  for (const e of entries) {
    if (e.action === "hub.purge") {
      const before = (e.before ?? {}) as { created_at?: string; name?: string };
      lives.push({
        label: `An earlier hub with this slug${before.name ? `, "${before.name}"` : ""} — created ${before.created_at ? when(before.created_at) : "?"}, purged ${when(e.at)}`,
        entries: [],
      });
    }
    lives[lives.length - 1].entries.push(e);
  }
  return lives.filter((l, i) => i === 0 || l.entries.length > 0);
}

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
  const saved = {
    hub_kind: c.hub_kind as string,
    name: c.name,
    hostname: c.hostname,
    jurisdiction_name: c.jurisdiction_name ?? "",
    jurisdiction_code: c.jurisdiction_code ?? "",
    jurisdiction_type: c.jurisdiction_type ?? "",
    jurisdiction_ocd_id: c.jurisdiction_ocd_id ?? "",
    jurisdiction_custom: c.jurisdiction_custom,
    governing_body: c.governing_body,
    governing_body_short: c.governing_body_short,
    status: c.status,
    mode: c.mode ?? "",
  };
  const [form, setForm] = useState(saved);
  const [choice, setChoice] = useState<JurisdictionChoice>(
    c.jurisdiction_custom
      ? { kind: "custom" }
      : c.hub_kind !== "place" && !c.jurisdiction_ocd_id && !c.jurisdiction_name
        ? { kind: "none" }
        : { kind: "unlinked" },
  );
  const isPlace = form.hub_kind === "place";

  // Choosing from the list fills the name, the code and the type; the
  // governing body is left as it is (it is this hub's copy).
  function pick(next: JurisdictionChoice) {
    setChoice(next);
    if (next.kind === "custom") {
      setForm((f) => ({ ...f, jurisdiction_custom: true, jurisdiction_ocd_id: "" }));
    } else if (next.kind === "none") {
      setForm((f) => ({ ...f, jurisdiction_custom: false, jurisdiction_ocd_id: "", jurisdiction_name: "" }));
    } else if (next.kind === "listed") {
      setForm((f) => ({
        ...f,
        jurisdiction_custom: false,
        jurisdiction_ocd_id: next.row.ocd_id,
        jurisdiction_name: next.row.display_name,
        // Shown only: the server sets the code the first time a hub without
        // one is linked, and never changes an existing one.
        jurisdiction_code: saved.jurisdiction_code || (jurisdictionCodeFor(next.row) ?? ""),
        jurisdiction_type: f.hub_kind === "place" ? hubTypeFor(next.row.type) : f.jurisdiction_type,
      }));
    } else {
      setForm((f) => ({ ...f, jurisdiction_custom: false, jurisdiction_ocd_id: saved.jurisdiction_ocd_id }));
    }
  }
  // Like Save plugins: nothing to save until a field differs from what the
  // server holds (the section remounts with fresh values after a save).
  const changed = (Object.keys(saved) as Array<keyof typeof saved>).some((k) => form[k] !== saved[k]);
  const { busy, save, note } = useSave(onSaved);
  const archived = Boolean(detail.hub.archived_at);
  const needsStepUp = form.hostname !== c.hostname || (form.status === "suspended" && c.status !== "suspended") || form.mode !== (c.mode ?? "");

  return (
    <form
      className="cx-card cx-form"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Record<string, unknown> = { ...form, jurisdiction_ocd_id: form.jurisdiction_ocd_id || null };
        delete patch.jurisdiction_code; // derived by the server, never sent
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
        <span>Kind of hub</span>
        <select
          value={form.hub_kind}
          onChange={(e) => {
            const k = e.target.value;
            setForm({ ...form, hub_kind: k });
            if (k === "place" && choice.kind === "none") setChoice({ kind: "unlinked" });
          }}
        >
          {HUB_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <small className="cx-muted">A place hub needs a jurisdiction; any other kind may have a related place, or none.</small>
      </label>
      <JurisdictionPicker
        optional={!isPlace}
        value={choice}
        onChange={pick}
        currentOcdId={c.jurisdiction_ocd_id}
        currentName={c.jurisdiction_name}
        hubId={detail.hub.id}
      />
      {choice.kind !== "none" && (
        <label className="cx-field">
          <span>{form.jurisdiction_custom ? "Name of the jurisdiction" : "Display name"}</span>
          <input value={form.jurisdiction_name} onChange={(e) => setForm({ ...form, jurisdiction_name: e.target.value })} />
          <small className="cx-muted">Changes to the jurisdiction are recorded in the audit trail.</small>
        </label>
      )}
      <div className="cx-field">
        <span>Jurisdiction code</span>
        <span className="cx-mono">{form.jurisdiction_code || "—"}</span>
        <small className="cx-muted">
          Derived from the OCD id when the hub is created (or first linked) and never changed: it is on everything the hub
          has published.
        </small>
      </div>
      {isPlace && (<>
      <label className="cx-field">
        <span>Jurisdiction type</span>
        <select value={form.jurisdiction_type} onChange={(e) => setForm({ ...form, jurisdiction_type: e.target.value })}>
          <option value="">Not set</option>
          {JURISDICTION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="cx-two">
        <label className="cx-field">
          <span>Governing body</span>
          <input
            value={form.governing_body}
            onChange={(e) => {
              const next = e.target.value;
              // The short form follows the name while it is still the usual one.
              const inStep = form.governing_body_short === defaultGoverningBodyShort(form.governing_body);
              setForm({ ...form, governing_body: next, governing_body_short: inStep ? defaultGoverningBodyShort(next) : form.governing_body_short });
            }}
          />
        </label>
        <label className="cx-field">
          <span>Short form</span>
          <input
            maxLength={40}
            value={form.governing_body_short}
            placeholder={defaultGoverningBodyShort(form.governing_body)}
            onChange={(e) => setForm({ ...form, governing_body_short: e.target.value })}
          />
          <small className="cx-muted">In pills and running text: "Council meeting summaries".</small>
        </label>
      </div>
      </>)}
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
        <button className="cx-btn cx-btn-primary" disabled={busy || !changed}>
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

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Refresh samples" (2026-10-07): demo hubs only, so it is not rendered otherwise. */
function SamplesSection({ detail }: { detail: HubDetail }) {
  const { busy, save, note } = useSave(() => {});
  const [done, setDone] = useState<SampleRefreshReport | null>(null);
  const { hub } = detail;
  const changed = done ? done.replaced.length + done.added.length + done.minutes_added.length : 0;

  return (
    <section className="cx-card cx-form">
      <h2 className="cx-h2">Sample content</h2>
      <p className="cx-muted cx-small">
        Every day, samples that close within three days (the open vote, the vote gathering endorsements, the open
        proposal, the conversation) are replaced with a fresh copy. Anything visitors added to those items goes with
        them. Refresh now does the same, and also adds any sample this hub is missing.
      </p>
      <div className="cx-actions">
        <button
          type="button"
          className="cx-btn"
          disabled={busy}
          onClick={() =>
            save(async () => {
              const { refresh } = await api.refreshSamples(hub.id);
              setDone(refresh);
              return null;
            })
          }
        >
          {busy ? "Refreshing…" : "Refresh samples"}
        </button>
      </div>
      {done && (
        <p className="cx-alert cx-alert-ok" role="status">
          {changed === 0
            ? "Every sample is current; nothing changed."
            : [
                done.replaced.length ? `Replaced: ${done.replaced.map((r) => r.key).join(", ")}.` : "",
                done.added.length ? `Added: ${done.added.join(", ")}.` : "",
                done.minutes_added.length ? `Minutes added to: ${done.minutes_added.join(", ")}.` : "",
              ]
                .filter(Boolean)
                .join(" ")}
        </p>
      )}
      {note}
    </section>
  );
}

function ExportSection({ detail, onExported, withStepUp }: { detail: HubDetail; onExported: () => void; withStepUp: WithStepUp }) {
  const { busy, save, note } = useSave(onExported);
  const [done, setDone] = useState<HubExport | null>(null);
  const { hub } = detail;

  return (
    <section className="cx-card cx-form">
      <h2 className="cx-h2">Export</h2>
      <p className="cx-muted cx-small">
        Everything this hub holds — its settings, residents, processes, comments, ballots and images — as one
        archive with a README that explains every file. Sign-in sessions, codes and secrets are left out. It
        contains personal data: keep it the way the hub's privacy policy promises.
      </p>
      <div className="cx-actions">
        <button
          type="button"
          className="cx-btn"
          disabled={busy}
          onClick={() =>
            save(async () => {
              const result = await withStepUp(`Exporting ${hub.id}`, (extra) => api.exportHub(hub.id, extra));
              if (result) setDone(result);
              return result;
            })
          }
        >
          {busy ? "Exporting…" : "Export this hub"}
        </button>
      </div>
      {done && (
        <p className="cx-alert cx-alert-ok" role="status">
          <a href={done.url} download={done.file_name}>
            Download {done.file_name}
          </a>{" "}
          ({sizeLabel(done.size)}, {done.rows} rows, {done.images} images). The link works until{" "}
          {when(done.expires_at)}; the file is deleted after 24 hours. Recorded in the audit trail.
        </p>
      )}
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
            slug and hostname stay taken; only a hub nobody ever used can be purged to free them. Type the slug to
            confirm.
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
