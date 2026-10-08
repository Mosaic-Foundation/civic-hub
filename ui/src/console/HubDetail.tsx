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
import {
  HANDED_OVER_NOTE,
  MODE_OWNER_NOTE,
  PLUGINS_OWNER_NOTE,
  hubSettingsUrl,
} from "../../../src/shared/settingOwners";
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
  // What a save changed beyond itself (a rename's followers, an invite), from the server.
  const [notice, setNotice] = useState<string | null>(null);
  const { withStepUp, dialog } = useStepUp();

  const load = useCallback(() => {
    api.hub(id).then(setDetail).catch((e: Error) => setError(e.message));
    api.audit(id).then((r) => setAudit(r.entries)).catch(() => setAudit([]));
    api.hubAdminAudit(id).then((r) => setAdminAudit(r.entries)).catch(() => setAdminAudit([]));
  }, [id]);

  useEffect(load, [load]);

  // Sections remount on fresh data (they are keyed on it), so the "saved"
  // notice lives here rather than in the section that saved.
  const reload = useCallback(
    (result?: unknown) => {
      const message = (result as { message?: unknown } | undefined)?.message;
      setNotice(typeof message === "string" && message ? message : null);
      setSaved(true);
      load();
    },
    [load],
  );

  // The plain "Saved" goes after a few seconds; a notice that says what else
  // changed stays until the next save, so it can be read.
  useEffect(() => {
    if (!saved || notice) return;
    const t = window.setTimeout(() => setSaved(false), 5000);
    return () => window.clearTimeout(t);
  }, [saved, notice]);

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
          {notice && <> {notice}</>}
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
        <HandoverSection key={JSON.stringify(detail.handover)} detail={detail} onSaved={reload} />
        <PluginsSection detail={detail} />
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

function useSave(onSaved: (result?: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(fn: () => Promise<unknown | null>) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result !== null) onSaved(result);
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
    status: c.status,
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
  const needsStepUp = form.hostname !== c.hostname || (form.status === "suspended" && c.status !== "suspended");

  return (
    <form
      className="cx-card cx-form"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Record<string, unknown> = { ...form, jurisdiction_ocd_id: form.jurisdiction_ocd_id || null };
        delete patch.jurisdiction_code; // derived by the server, never sent
        save(() => withStepUp("This change", (extra) => api.updateHub(detail.hub.id, { ...patch, ...extra })));
      }}
    >
      <h2 className="cx-h2">Configuration</h2>
      <label className="cx-field">
        <span>Name</span>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <small className="cx-muted">
          {detail.handover.editable
            ? "The registry name. Renaming here also renames the hub where residents see it, and its operator and email sender name, wherever they still read the old name."
            : "The registry name. This hub has left demo, so the name residents see is its admins' (Settings → Identity); renaming here does not change it."}
        </small>
      </label>
      <label className="cx-field">
        <span>Hostname</span>
        <input className="cx-mono" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value.toLowerCase().trim() })} />
        <small className="cx-muted">
          Moving it keeps old links working: the old address redirects here, path and all, and stays taken. Its DID
          does not change.
        </small>
        {c.previous_hostnames.length > 0 && (
          <small className="cx-muted">
            Redirects here from: <span className="cx-mono">{c.previous_hostnames.join(", ")}</span>
          </small>
        )}
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
      </>)}
      <div className="cx-two">
        <label className="cx-field">
          <span>Status</span>
          <select value={form.status} disabled={archived} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">active (serving)</option>
            <option value="suspended">suspended (paused page)</option>
          </select>
        </label>
        <div className="cx-field">
          <span>Mode</span>
          <span>
            <ModeBadge mode={detail.hub.mode} />
          </span>
          <small className="cx-muted">
            {MODE_OWNER_NOTE}{" "}
            <a href={hubSettingsUrl(detail.hub.hostname, "mode")} target="_blank" rel="noreferrer">
              Open Settings → Mode
            </a>
          </small>
        </div>
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

/** Each handover field: its label, where the hub's admins change it, and what it says when empty. */
const HANDOVER_FIELDS: ReadonlyArray<{
  key: string;
  label: string;
  section: string;
  kind: "text" | "email" | "textarea";
  hint: string;
  placeOnly?: boolean;
}> = [
  { key: "identity.name", label: "Hub name", section: "identity", kind: "text", hint: "The header on every page, the browser tab, the legal documents. A new name also replaces the operator and email sender name where they still read the old one." },
  { key: "legal.operator_name", label: "Operated by", section: "legal", kind: "text", hint: "Who answers for the hub, printed in the legal documents: a person, a group or an office." },
  { key: "legal.contact_email", label: "Contact address", section: "legal", kind: "email", hint: "Where the documents tell people to write. Empty: the platform's address." },
  { key: "legal.who_runs_this", label: '"Who runs this site"', section: "legal", kind: "textarea", hint: "The paragraph that opens the Privacy Policy and the Terms. Empty: the shared paragraph, which says the hub is not run by local government. Write one if that is not true." },
  { key: "email.from_name", label: "Email from name", section: "email", kind: "text", hint: "The sender name on every email the hub sends." },
  { key: "email.postal_address", label: "Postal address", section: "email", kind: "textarea", hint: "In the footer of digests. Empty: the platform's address." },
  { key: "plugin.feedback.contact_email", label: "Feedback address", section: "plugins", kind: "email", hint: "Shown on the Feedback page for people who would rather email. Empty: the contact address." },
  { key: "copy.governing_body_name", label: "Governing body", section: "copy", kind: "text", hint: "Sample content and delivered results name it.", placeOnly: true },
  { key: "copy.governing_body_short", label: "Board label", section: "copy", kind: "text", hint: 'In pills and running text: "Council meeting summaries". Empty: from the governing body.', placeOnly: true },
];

/** "you, in the console" / "the hub's admins" / a script's name, for the "last changed" lines. */
function changedBy(by: string | null): string {
  if (!by) return "someone";
  if (by.startsWith("console:")) return `the console (${by.slice("console:".length)})`;
  if (by.startsWith("user_")) return "the hub's admins";
  return by;
}

/**
 * What residents see about who runs the hub (review R48). The console sets it
 * while the hub is a demo, to hand it over ready; once the hub's admins move
 * it to beta, it is theirs, and this shows it read-only with links.
 */
function HandoverSection({ detail, onSaved }: { detail: HubDetail; onSaved: (result?: unknown) => void }) {
  const h = detail.handover;
  const [form, setForm] = useState<Record<string, string>>(h.values);
  const { busy, save, note } = useSave(onSaved);
  const isPlace = detail.config.hub_kind === "place";
  const fields = HANDOVER_FIELDS.filter((f) => isPlace || !f.placeOnly);
  const changed = Object.fromEntries(fields.filter((f) => (form[f.key] ?? "") !== (h.values[f.key] ?? "")).map((f) => [f.key, form[f.key] ?? ""]));
  const placeholder = (key: string): string => {
    switch (key) {
      case "identity.name":
        return detail.hub.name;
      case "legal.operator_name":
      case "email.from_name":
        return form["identity.name"] || detail.hub.name;
      case "legal.contact_email":
        return h.fallbacks.contact_email;
      case "email.postal_address":
        return h.fallbacks.postal_address;
      case "plugin.feedback.contact_email":
        return form["legal.contact_email"] || h.fallbacks.feedback_email;
      case "copy.governing_body_short":
        return defaultGoverningBodyShort(form["copy.governing_body_name"] ?? "");
      default:
        return "";
    }
  };

  return (
    <form
      className="cx-card cx-form"
      aria-label="Handover"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => api.setHandover(detail.hub.id, changed));
      }}
    >
      <h2 className="cx-h2">Handover</h2>
      <p className="cx-muted cx-small">
        {h.editable
          ? "Who runs this hub and how it signs its emails, as residents will see them. Set them before handing the hub over; its admins can change them too, and once they move it to beta they are theirs alone."
          : HANDED_OVER_NOTE}
      </p>
      {fields.map((f) => {
        const last = h.changed[f.key];
        const settingsLink = (
          <a href={hubSettingsUrl(detail.hub.hostname, f.section)} target="_blank" rel="noreferrer">
            Settings
          </a>
        );
        return (
          <label className="cx-field" key={f.key}>
            <span>{f.label}</span>
            {!h.editable ? (
              <span className={f.kind === "textarea" ? "cx-pre" : undefined}>
                {h.values[f.key] || <span className="cx-muted">{placeholder(f.key) ? `Not set: ${placeholder(f.key)}` : "Not set"}</span>}
              </span>
            ) : f.kind === "textarea" ? (
              <textarea
                rows={f.key === "legal.who_runs_this" ? 4 : 2}
                value={form[f.key] ?? ""}
                placeholder={placeholder(f.key)}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            ) : (
              <input
                type={f.kind === "email" ? "email" : "text"}
                value={form[f.key] ?? ""}
                placeholder={placeholder(f.key)}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            )}
            <small className="cx-muted">
              {f.hint}
              {last && <> Last changed by {changedBy(last.by)}, {when(last.at)}.</>}
              {!h.editable && <> Changed in the hub's {settingsLink}.</>}
            </small>
          </label>
        );
      })}
      {note}
      {h.editable && (
        <div className="cx-actions">
          <button className="cx-btn cx-btn-primary" disabled={busy || Object.keys(changed).length === 0}>
            {busy ? "Saving…" : "Save handover details"}
          </button>
        </div>
      )}
    </form>
  );
}

/**
 * Read-only (review R10, Adam 2026-10-08): the create form sets where the
 * switches start, and from then on they are the hub's admins'.
 */
function PluginsSection({ detail }: { detail: HubDetail }) {
  return (
    <section className="cx-card cx-form" aria-label="Plugins">
      <h2 className="cx-h2">Plugins</h2>
      <p className="cx-muted cx-small">
        {PLUGINS_OWNER_NOTE}{" "}
        <a href={hubSettingsUrl(detail.hub.hostname, "plugins")} target="_blank" rel="noreferrer">
          Open Settings → Plugins
        </a>
      </p>
      <ul className="cx-toggles">
        {detail.plugins.map((p) => (
          <li key={p.id}>
            <span>
              {p.enabled ? "On" : "Off"} · {PLUGIN_NAMES[p.id] ?? p.id}
            </span>
            {p.source !== "hub" && <span className="cx-muted cx-small">{p.source === "environment" ? "from env" : "default"}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdminsSection({ detail, onSaved, withStepUp }: { detail: HubDetail; onSaved: () => void; withStepUp: WithStepUp }) {
  const [adding, setAdding] = useState("");
  const { busy, save, note } = useSave(onSaved);
  const admins = detail.admins;

  return (
    <section className="cx-card cx-form">
      <h2 className="cx-h2">Admins</h2>
      <p className="cx-muted cx-small">
        Who administers this hub from its own Settings. Adding or removing someone needs a fresh code, as on the
        hub's own Admins &amp; board page, where its admins can change this list too. Someone added gets an email
        with a link and the first steps.
      </p>
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
            const r = await withStepUp(`Adding ${email}`, (extra) => api.setAdmins(detail.hub.id, [...admins, email], extra));
            if (r) setAdding("");
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
  const [titles, setTitles] = useState<Record<string, string>>({});
  const { hub } = detail;
  const changed = done ? done.replaced.length + done.added.length + done.minutes_added.length : 0;
  // What the hub shows, quoted; the id only if a template has no title.
  const named = (keys: string[]) => keys.map((k) => (titles[k] ? `"${titles[k]}"` : k)).join(", ");

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
              const { refresh, titles: t } = await api.refreshSamples(hub.id);
              setTitles(t ?? {});
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
                done.replaced.length ? `Replaced: ${named(done.replaced.map((r) => r.key))}.` : "",
                done.added.length ? `Added: ${named(done.added)}.` : "",
                done.minutes_added.length ? `Minutes added to: ${named(done.minutes_added)}.` : "",
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
  const [unarchiving, setUnarchiving] = useState(false);

  return (
    <section className="cx-card cx-form cx-danger-zone">
      <h2 className="cx-h2">Archive</h2>
      {hub.archived_at ? (
        <>
          <p className="cx-muted cx-small">
            Unarchiving clears the archive mark. The hub stays suspended until you set its status to active.
          </p>
          {unarchiving ? (
            <div className="cx-actions" role="group" aria-label="Confirm unarchive">
              <span className="cx-small">Unarchive {hub.id}? It stays suspended until you set it active.</span>
              <button type="button" className="cx-btn" disabled={busy} onClick={() => setUnarchiving(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="cx-btn cx-btn-primary"
                disabled={busy}
                onClick={() => save(() => api.unarchive(hub.id))}
              >
                Yes, unarchive
              </button>
            </div>
          ) : (
            <div className="cx-actions">
              <button type="button" className="cx-btn" disabled={busy} onClick={() => setUnarchiving(true)}>
                Unarchive
              </button>
            </div>
          )}
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
