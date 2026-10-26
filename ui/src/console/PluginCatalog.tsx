// The plugin catalog (ADR-014): every package version that has passed the
// conformance suite, waiting for the operator's approval or approved, with
// what it may touch in plain words. Approving lets every hub on this
// deployment run exactly those files (their hash); withdrawing stops it
// within a minute. Both take a fresh code and are audited.
//
// Approving signs the entry with this deployment's catalog key (ADR-015).
// "Sign approved entries" signs the ones approved before signatures, and all
// of them again after the key is rotated.
//
// Below, what this deployment loads and whether each package is mounted:
// a package whose files no approved entry records is not mounted, and its
// hubs are without it until an entry is approved.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PluginCatalog, type PluginCatalogEntry } from "./api";
import { useStepUp } from "./StepUp";

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

export default function PluginCatalogPage() {
  const [data, setData] = useState<PluginCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { withStepUp, dialog } = useStepUp();

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
        Each entry is one version of a plugin, as it was when it passed the conformance checks. Approving an entry signs
        it and lets every hub on this deployment install and run exactly that code; if its files change, it stops running
        until a new entry is approved. A hub on an older version is offered the update with what changes. A version
        marked required is recorded on every hub without asking, and each hub&rsquo;s Plugins page says so.
      </p>
      {error && <p className="cx-alert cx-alert-error" role="alert">{error}</p>}
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
          <section className="cx-card" aria-label="Catalog entries">
            <h2 className="cx-h2">Catalog</h2>
            {data.entries.length === 0 && <p className="cx-muted">No entries yet.</p>}
            <ul className="cx-plugin-list">
              {data.entries.map((e) => (
                <li key={e.id} className="cx-plugin-entry" data-testid={`catalog-${e.package}`}>
                  <div className="cx-plugin-head">
                    <strong>{e.display_name}</strong> <span className="cx-mono cx-small">{e.package}@{e.version}</span>{" "}
                    <span className={`cx-plugin-status cx-plugin-${e.status}`}>{STATUS_LABEL[e.status]}</span>
                    {e.required && <span className="cx-plugin-status cx-plugin-required">Required</span>}
                    {!e.auto_install && <span className="cx-muted cx-small"> · not installed on new hubs</span>}
                    {!e.matches_deployment && <span className="cx-muted cx-small"> · not the files this deployment runs</span>}
                  </div>
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
                    {(e.status === "pending" || e.status === "withdrawn") && (
                      <button type="button" className="cx-btn cx-btn-primary" disabled={busy !== null} onClick={() => act(e, "approve")}>
                        Approve
                      </button>
                    )}
                    {e.status === "approved" && (
                      <button type="button" className="cx-btn cx-btn-quiet" disabled={busy !== null} onClick={() => act(e, "withdraw")}>
                        Withdraw
                      </button>
                    )}
                    {e.status === "approved" && (
                      <button type="button" className="cx-btn cx-btn-quiet" disabled={busy !== null} onClick={() => setRequired(e, !e.required)}>
                        {e.required ? "Not required" : "Mark required"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="cx-card" aria-label="This deployment">
            <h2 className="cx-h2">On this deployment</h2>
            <div className="cx-table-wrap">
              <table className="cx-table">
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Version</th>
                    <th>Running</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deployment.map((v) => (
                    <tr key={v.package}>
                      <td className="cx-mono">{v.package}</td>
                      <td className="cx-mono">{v.version}</td>
                      <td>{v.mounted ? "Yes" : <>No: {v.reason}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {dialog}
    </div>
  );
}
