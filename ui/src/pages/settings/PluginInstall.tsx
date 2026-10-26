// Install and Remove for a plugin a package provides (ADR-014), in its card
// on the Plugins page. Replaces the on/off switch for these plugins, with the
// same meaning: Remove → Stop now is what switching off always did (nothing is
// deleted; Install brings everything back), and Remove → Wind down lets what
// is open run to its close first. Install shows what the plugin will be able
// to do, in the words of src/shared/pluginGrant.ts.
//
// The rules are the server's (src/services/pluginInstall.ts); this only asks
// and shows.

import { useState } from "react";
import Modal from "../../components/Modal";
import { adminInstallPlugin, adminRemovePlugin, type PluginInstall } from "../../services/api";
import { formatDate } from "../../utils/dates";

function versions(install: PluginInstall): string {
  return install.packages.length === 1
    ? `version ${install.packages[0].version}`
    : install.packages.map((p) => `${p.display_name} ${p.version}`).join(", ");
}

function openItems(n: number): string {
  return `${n} open ${n === 1 ? "item" : "items"}`;
}

export function PluginInstallControls({ install, onChanged }: { install: PluginInstall; onChanged: () => void }) {
  const [asking, setAsking] = useState<"install" | "remove" | null>(null);
  return (
    <div className="plugin-install" data-testid={`plugin-install-${install.plugin}`}>
      {install.state === "installed" && (
        <p className="plugin-install-state">
          <span className="plugin-install-label">Installed</span>, {versions(install)}.
          <button type="button" className="plugin-install-button" onClick={() => setAsking("remove")}>
            Remove…
          </button>
        </p>
      )}
      {install.state === "winding_down" && (
        <div className="plugin-install-state" role="status">
          <p>
            <span className="plugin-install-label">Winding down</span>: {openItems(install.open)} still running. Nothing
            new can be started. It switches off by itself when the last one closes.
          </p>
          <p className="plugin-install-actions">
            <button type="button" className="plugin-install-button" onClick={() => setAsking("remove")}>
              Stop now…
            </button>
            <button type="button" className="plugin-install-button" onClick={() => setAsking("install")}>
              Keep it installed…
            </button>
          </p>
        </div>
      )}
      {install.state === "removed" && (
        <p className="plugin-install-state">
          <span className="plugin-install-label">Not installed.</span> Its items and settings are kept, and come back if
          you install it again.
          <button type="button" className="plugin-install-button" onClick={() => setAsking("install")}>
            Install…
          </button>
        </p>
      )}
      {install.state === "unavailable" && (
        <p className="plugin-install-state" role="status">
          <span className="plugin-install-label">Not available right now.</span> Civic.Social has been told and is looking
          into it. Its items and settings are kept.
        </p>
      )}
      {asking === "install" && <InstallDialog install={install} onClose={() => setAsking(null)} onDone={onChanged} />}
      {asking === "remove" && <RemoveDialog install={install} onClose={() => setAsking(null)} onDone={onChanged} />}
    </div>
  );
}

function InstallDialog({ install, onClose, onDone }: { install: PluginInstall; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await adminInstallPlugin(install.plugin);
      onClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install it.");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Install ${install.name}?`} onClose={onClose} dismissible={!busy} className="plugin-install-dialog">
      {install.packages.map((p) => (
        <section key={p.package} className="plugin-grant" aria-label={`What ${p.display_name} can do`}>
          <h3 className="plugin-grant-title">{p.display_name} will be able to:</h3>
          <ul>
            {p.grant.can.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {p.grant.cannot.length > 0 && (
            <>
              <h3 className="plugin-grant-title">It will not be able to:</h3>
              <ul>
                {p.grant.cannot.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <p className="form-hint">
            Version {p.version}
            {p.checked_at ? `, checked by Civic.Social on ${formatDate(p.checked_at)}` : ""}.
          </p>
        </section>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="draft-submit-btn" onClick={confirm} disabled={busy}>
          {busy ? "Installing…" : "Install"}
        </button>
        <button type="button" className="draft-secondary-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function RemoveDialog({ install, onClose, onDone }: { install: PluginInstall; onClose: () => void; onDone: () => void }) {
  const canWindDown = install.state === "installed" && install.wind_down_offered && install.open > 0;
  const [mode, setMode] = useState<"stop" | "wind_down">(canWindDown ? "wind_down" : "stop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await adminRemovePlugin(install.plugin, mode);
      onClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove it.");
      setBusy(false);
    }
  }
  const name = install.name;
  return (
    <Modal title={`Remove ${name}?`} onClose={onClose} dismissible={!busy} className="plugin-install-dialog">
      <fieldset className="plugin-remove-modes">
        <legend className="visually-hidden">How to remove it</legend>
        {install.state === "installed" && (
          <label className={`plugin-remove-mode${canWindDown ? "" : " is-disabled"}`}>
            <input
              type="radio"
              name="remove-mode"
              value="wind_down"
              checked={mode === "wind_down"}
              disabled={!canWindDown || busy}
              onChange={() => setMode("wind_down")}
            />
            <span>
              <strong>Wind down</strong>
              <span className="plugin-remove-detail">
                {!install.wind_down_offered
                  ? `${name}'s items don't close by themselves, so it can only be stopped.`
                  : install.open === 0
                    ? "Nothing is open, so there is nothing to wait for: it stops now."
                    : `Nothing new can be started from now on. The ${openItems(install.open)} run to their close and publish their results as usual. When the last one closes, ${name} switches off by itself.`}
              </span>
            </span>
          </label>
        )}
        <label className="plugin-remove-mode">
          <input type="radio" name="remove-mode" value="stop" checked={mode === "stop"} disabled={busy} onChange={() => setMode("stop")} />
          <span>
            <strong>Stop now</strong>
            <span className="plugin-remove-detail">
              {name} switches off at once: its pages and menus disappear
              {install.open > 0 ? `, its ${openItems(install.open)} are hidden, and nothing closes at its deadline` : ""}.
              Nothing is deleted: installing it again brings everything back as it was.
            </span>
          </span>
        </label>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="draft-submit-btn" onClick={confirm} disabled={busy}>
          {busy ? "Removing…" : mode === "wind_down" ? "Wind down" : "Stop now"}
        </button>
        <button type="button" className="draft-secondary-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
