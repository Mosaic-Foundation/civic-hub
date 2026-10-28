// Install and Remove for a plugin a package provides (ADR-014), in its card
// on the Plugins page. Replaces the on/off switch for these plugins, with the
// same meaning: Remove → Stop now is what switching off always did (nothing is
// deleted; Install brings everything back), and Remove → Wind down lets what
// is open run to its close first. Install shows what the plugin will be able
// to do, in the words of src/shared/pluginGrant.ts.
//
// Update (plugin session 2, ADR-015): when this deployment runs a newer
// version than the hub approved, the card says so and Update shows what
// changes in what it can do, in the same words. Until then it runs without
// what the new version adds. A version Civic.Social marked required is
// recorded on every hub, and the card says when and from what.
//
// The rules are the server's (src/services/pluginInstall.ts); this only asks
// and shows.

import { useState } from "react";
import Modal from "../../components/Modal";
import HelpButton from "../../components/HelpButton";
import { adminInstallPlugin, adminRemovePlugin, adminUpdatePlugin, type PluginInstall } from "../../services/api";
import { formatDate } from "../../utils/dates";

function versions(install: PluginInstall): string {
  return install.packages.length === 1
    ? `version ${install.packages[0].version}`
    : install.packages.map((p) => `${p.display_name} ${p.version}`).join(", ");
}

function openItems(n: number): string {
  return `${n} open ${n === 1 ? "item" : "items"}`;
}

/** The newer version an update would record (the first package's, which names the plugin). */
function updateVersion(install: PluginInstall): string | null {
  return install.packages.find((p) => p.update)?.update?.version ?? null;
}

function UpdateNotices({ install, onUpdate }: { install: PluginInstall; onUpdate: () => void }) {
  const required = install.packages.filter((p) => p.required_update);
  const next = updateVersion(install);
  const adds = install.packages.flatMap((p) => p.update?.adds ?? []);
  return (
    <>
      {required.map((p) => (
        <p key={p.package} className="plugin-install-notice" role="status">
          Civic.Social updated {p.display_name} from version {p.required_update!.from} to {p.required_update!.to} on{" "}
          {formatDate(p.required_update!.at)}. This update was required on every hub.
        </p>
      ))}
      {next && (
        <div className="plugin-install-update" role="status">
          <p>
            <span className="plugin-install-label">Update available</span>: version {next}.
            {adds.length > 0
              ? " Until you update, it keeps to what you approved, and does without what the new version adds."
              : " It changes nothing in what it can do."}
            <button type="button" className="plugin-install-button" onClick={onUpdate}>
              Update…
            </button>{" "}
            <HelpButton k="plugins.update" label="Update" />
          </p>
        </div>
      )}
    </>
  );
}

export function PluginInstallControls({ install, onChanged }: { install: PluginInstall; onChanged: () => void }) {
  const [asking, setAsking] = useState<"install" | "remove" | "update" | null>(null);
  return (
    <div className="plugin-install" data-testid={`plugin-install-${install.plugin}`}>
      {(install.state === "installed" || install.state === "winding_down") && (
        <UpdateNotices install={install} onUpdate={() => setAsking("update")} />
      )}
      {install.state === "installed" && (
        <p className="plugin-install-state">
          <span className="plugin-install-label">Installed</span>, {versions(install)}.
          <button type="button" className="plugin-install-button" onClick={() => setAsking("remove")}>
            Remove…
          </button>{" "}
          <HelpButton k="plugins.remove" label="Remove" />
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
          </button>{" "}
          <HelpButton k="plugins.install" label="Install" />
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
      {asking === "update" && <UpdateDialog install={install} onClose={() => setAsking(null)} onDone={onChanged} />}
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

function UpdateDialog({ install, onClose, onDone }: { install: PluginInstall; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await adminUpdatePlugin(install.plugin);
      onClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update it.");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Update ${install.name} to version ${updateVersion(install) ?? ""}?`} onClose={onClose} dismissible={!busy} className="plugin-install-dialog">
      {install.packages
        .filter((p) => p.update)
        .map((p) => (
          <section key={p.package} className="plugin-grant" aria-label={`What changes for ${p.display_name}`}>
            {p.update!.adds.length === 0 && p.update!.drops.length === 0 && (
              <p>Nothing changes in what {p.display_name} can do.</p>
            )}
            {p.update!.adds.length > 0 && (
              <>
                <h3 className="plugin-grant-title">{p.display_name} will also be able to:</h3>
                <ul>
                  {p.update!.adds.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            {p.update!.drops.length > 0 && (
              <>
                <h3 className="plugin-grant-title">It will no longer:</h3>
                <ul>
                  {p.update!.drops.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="form-hint">
              From version {p.version} to {p.update!.version}
              {p.checked_at ? `, checked by Civic.Social on ${formatDate(p.checked_at)}` : ""}. Everything it already holds is
              kept, and what is open carries on.
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
          {busy ? "Updating…" : "Update"}
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
                  ? "What it holds doesn't close by itself, so it can only be stopped."
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
