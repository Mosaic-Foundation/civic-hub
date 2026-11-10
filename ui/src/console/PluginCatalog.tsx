// The plugin catalog (ADR-014): every package version that has passed the
// conformance suite, waiting for the operator's approval or approved, with
// what it may touch in plain words. Approving lets every hub on this
// deployment run exactly those files (their hash); withdrawing stops it
// within a minute. Both take a fresh code and are audited.
//
// One fresh code confirms the catalog's actions (Approve, Withdraw, Sign,
// Mark required) for ten minutes on this session, each still audited; the
// page says until when.
//
// Approving signs the entry with this deployment's catalog key (ADR-015).
// "Sign approved entries" signs the ones approved before signatures, and all
// of them again after the key is rotated.
//
// One row per plugin (console slice, 2026-11-09): the version this
// deployment runs, Approve on the newest version waiting, and a Version
// dropdown, newest first, keeping every version (withdrawn ones too) as the
// audit trail. A package whose files no approved entry records is not
// mounted, and its hubs are without it until an entry is approved.

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { api, ApiError, type PluginCatalog, type PluginCatalogEntry } from "./api";
import { useStepUp } from "./StepUp";
import { pluginRows, type PluginRow } from "./pluginRows";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_LABEL: Record<PluginCatalogEntry["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  withdrawn: "Withdrawn",
};

/** A version's words in the dropdown: its number, and running or its status. */
function optionLabel(e: PluginCatalogEntry, row: PluginRow): string {
  const what = row.running?.id === e.id ? "running" : STATUS_LABEL[e.status].toLowerCase();
  return `${e.version} (${what}${e.required ? ", required" : ""})`;
}

/**
 * One plugin: its name, the version this deployment runs, Approve on the
 * newest version waiting, and a dropdown of every version, newest first, with
 * the chosen one's record below it (who approved it and when, its signature,
 * its withdrawal, what it may do).
 */
function PluginRowItem({
  row,
  busy,
  onAct,
  onRequired,
}: {
  row: PluginRow;
  busy: string | null;
  onAct: (entry: PluginCatalogEntry, kind: "approve" | "withdraw") => void;
  onRequired: (entry: PluginCatalogEntry, required: boolean) => void;
}) {
  const selectId = useId();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen =
    row.versions.find((e) => e.id === chosenId) ?? row.running ?? row.pending ?? row.versions[0] ?? null;
  const verdict = row.deployment;

  return (
    <li className="cx-plugin-entry" data-testid={`catalog-${row.package}`}>
      <div className="cx-plugin-head">
        <strong>{row.name}</strong> <span className="cx-mono cx-small cx-break">{row.package}</span>
        {row.running ? (
          <span className="cx-plugin-status cx-plugin-running" data-testid="catalog-running">
            Running {row.running.version}
          </span>
        ) : verdict ? (
          <span className="cx-plugin-status cx-plugin-pending" data-testid="catalog-running">
            Not running {verdict.version}
          </span>
        ) : (
          <span className="cx-muted cx-small" data-testid="catalog-running">Not on this deployment</span>
        )}
        {row.running?.required && <span className="cx-plugin-status cx-plugin-required">Required</span>}
      </div>
      {verdict && !verdict.mounted && verdict.reason && <p className="cx-small cx-muted">{verdict.reason}</p>}
      {row.pending && (
        <div className="cx-actions cx-plugin-pending-line">
          <p className="cx-small">
            Version <span className="cx-mono">{row.pending.version}</span> is waiting for approval
            {row.pending.matches_deployment ? ": this deployment loads its files." : "."}
          </p>
          <button
            type="button"
            className="cx-btn cx-btn-primary"
            disabled={busy !== null}
            onClick={() => onAct(row.pending!, "approve")}
          >
            Approve
          </button>
        </div>
      )}
      {chosen && (
        <div className="cx-plugin-versions">
          <label className="cx-field cx-plugin-version-field" htmlFor={selectId}>
            <span>Version</span>
            <select
              id={selectId}
              value={chosen.id}
              onChange={(ev) => setChosenId(ev.target.value)}
              data-testid="catalog-version"
            >
              {row.versions.map((e) => (
                <option key={e.id} value={e.id}>
                  {optionLabel(e, row)}
                </option>
              ))}
            </select>
          </label>
          <VersionRecord
            entry={chosen}
            running={row.running?.id === chosen.id}
            approveHere={row.pending?.id !== chosen.id}
            busy={busy}
            onAct={onAct}
            onRequired={onRequired}
          />
        </div>
      )}
    </li>
  );
}

/** One version's record: the audit trail and its actions. */
function VersionRecord({
  entry: e,
  running,
  approveHere,
  busy,
  onAct,
  onRequired,
}: {
  entry: PluginCatalogEntry;
  running: boolean;
  approveHere: boolean;
  busy: string | null;
  onAct: (entry: PluginCatalogEntry, kind: "approve" | "withdraw") => void;
  onRequired: (entry: PluginCatalogEntry, required: boolean) => void;
}) {
  return (
    <div className="cx-plugin-record" data-testid="catalog-record">
      <p className="cx-small">
        <span className={`cx-plugin-status cx-plugin-${e.status}`} data-testid="catalog-version-status">
          {STATUS_LABEL[e.status]}
        </span>
        {e.required && <span className="cx-plugin-status cx-plugin-required">Required</span>}
        {running && <span className="cx-muted"> · running here</span>}
        {!e.auto_install && <span className="cx-muted"> · not installed on new hubs</span>}
        {!e.matches_deployment && <span className="cx-muted"> · not the files this deployment runs</span>}
      </p>
      <p className="cx-small cx-muted">
        Passed the conformance checks on {when(e.conformance.ran_at)}
        {e.conformance.commit ? <> (<span className="cx-mono">{e.conformance.commit}</span>)</> : null}.
        {e.approved_at && <> Approved by {e.approved_by} on {when(e.approved_at)}.</>}
        {e.status === "approved" && (e.signed ? <> Signed ({e.signature_key}).</> : <> Not signed with this deployment&rsquo;s key.</>)}
        {e.withdrawn_at && <> Withdrawn on {when(e.withdrawn_at)}.</>}
      </p>
      <details>
        <summary className="cx-small">What it may do</summary>
        <ul className="cx-small">
          {e.grant.can.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {e.grant.cannot.length > 0 && (
          <>
            <p className="cx-small">It cannot:</p>
            <ul className="cx-small">
              {e.grant.cannot.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </>
        )}
        <p className="cx-small cx-muted cx-mono cx-break">{e.hash}</p>
      </details>
      {e.notes && <p className="cx-small">Note: {e.notes}</p>}
      <div className="cx-actions">
        {approveHere && (e.status === "pending" || e.status === "withdrawn") && (
          <button type="button" className="cx-btn cx-btn-primary" disabled={busy !== null} onClick={() => onAct(e, "approve")}>
            Approve
          </button>
        )}
        {e.status === "approved" && (
          <button type="button" className="cx-btn cx-btn-quiet" disabled={busy !== null} onClick={() => onAct(e, "withdraw")}>
            Withdraw
          </button>
        )}
        {e.status === "approved" && (
          <button type="button" className="cx-btn cx-btn-quiet" disabled={busy !== null} onClick={() => onRequired(e, !e.required)}>
            {e.required ? "Not required" : "Mark required"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PluginCatalogPage() {
  const [data, setData] = useState<PluginCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { withStepUp, dialog } = useStepUp();
  const rows = useMemo(() => (data ? pluginRows(data.entries, data.deployment) : []), [data]);

  const load = useCallback(() => {
    api.plugins().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  async function signAll() {
    setBusy("sign");
    setError(null);
    try {
      const next = await withStepUp("Signing the approved entries", (extra) => api.signPlugins(extra));
      if (next) setData(next);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function setRequired(entry: PluginCatalogEntry, required: boolean) {
    setBusy(entry.id);
    setError(null);
    try {
      const what = required ? `Marking ${entry.display_name} ${entry.version} required` : `${entry.display_name} ${entry.version} no longer required`;
      const next = await withStepUp(what, (extra) => api.requirePlugin(entry.id, required, extra));
      if (next) setData(next);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(entry: PluginCatalogEntry, kind: "approve" | "withdraw") {
    setBusy(entry.id);
    setError(null);
    try {
      const what = kind === "approve" ? `Approving ${entry.display_name} ${entry.version}` : `Withdrawing ${entry.display_name} ${entry.version}`;
      const next = await withStepUp(what, (extra) =>
        kind === "approve" ? api.approvePlugin(entry.id, extra) : api.withdrawPlugin(entry.id, extra),
      );
      if (next) setData(next);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="cx-title">Plugins</h1>
      <p className="cx-muted cx-block-text">
        One row per plugin, with the version this deployment runs. Each version is recorded as it was when it passed the
        conformance checks; the Version dropdown keeps every one, newest first, with who approved or withdrew it. Approving
        a version signs it and lets every hub on this deployment install and run exactly that code; if its files change,
        it stops running until a new version is approved. A hub on an older version is offered the update with what changes. A version
        marked required is recorded on every hub without asking, and each hub&rsquo;s Plugins page says so.
      </p>
      {error && <p className="cx-alert cx-alert-error" role="alert">{error}</p>}
      {data?.confirmed_until && (
        <p className="cx-small cx-muted" data-testid="catalog-confirmed">
          Your code confirms catalog changes until{" "}
          {new Date(data.confirmed_until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}: no code is
          needed for them until then. Each change is still recorded.
        </p>
      )}
      {!data && !error && <p className="cx-muted">Loading…</p>}
      {data && (
        <>
          <section className="cx-card" aria-label="Signatures">
            <h2 className="cx-h2">Signatures</h2>
            <p className="cx-small">
              {data.signing.key ? (
                <>
                  Approvals are signed with this deployment&rsquo;s catalog key{" "}
                  <span className="cx-mono">{data.signing.key.id}</span>.{" "}
                </>
              ) : (
                <>This deployment has no catalog key, so approvals are not signed. </>
              )}
              {data.signing.mode === "required"
                ? "A plugin runs only on a signed approval."
                : "Until signatures are required, an approved entry without one still runs on its fingerprint."}
            </p>
            {data.signing.problem && <p className="cx-alert cx-alert-error" role="alert">{data.signing.problem}</p>}
            {data.signing.key && (
              <>
                <p className="cx-small" data-testid="catalog-unsigned">
                  {data.signing.unsigned === 0
                    ? "Every approved entry is signed with this key."
                    : `${data.signing.unsigned} approved ${data.signing.unsigned === 1 ? "entry is" : "entries are"} not signed with this key.`}
                </p>
                {data.signing.unsigned > 0 && (
                  <div className="cx-actions">
                    <button type="button" className="cx-btn cx-btn-primary" disabled={busy !== null} onClick={signAll}>
                      Sign approved entries
                    </button>
                  </div>
                )}
                <details>
                  <summary className="cx-small">Public key</summary>
                  <p className="cx-small cx-muted cx-mono cx-break">{data.signing.key.public_key}</p>
                </details>
              </>
            )}
          </section>
          <section className="cx-card" aria-label="Plugins on this deployment">
            <h2 className="cx-h2">Catalog</h2>
            {rows.length === 0 && <p className="cx-muted">No entries yet.</p>}
            <ul className="cx-plugin-list">
              {rows.map((row) => (
                <PluginRowItem
                  key={row.package}
                  row={row}
                  busy={busy}
                  onAct={act}
                  onRequired={setRequired}
                />
              ))}
            </ul>
          </section>
        </>
      )}
      {dialog}
    </div>
  );
}
