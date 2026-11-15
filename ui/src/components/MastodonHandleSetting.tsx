import { useEffect, useId, useState } from "react";
import { useAuth } from "../context/authState";
import { useHub } from "../config/hub";
import { setMastodonHandle } from "../services/api";

/**
 * "Mastodon" in a person's Settings (2026-11-15): the handle Share on
 * Mastodon saved the first time it asked, to change or clear. Shown on hubs
 * with the Fediverse feature on.
 */
export default function MastodonHandleSetting() {
  const hub = useHub();
  const { user, updateUser } = useAuth();
  const id = useId();
  const [value, setValue] = useState(user?.mastodon_handle ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(user?.mastodon_handle ?? ""), [user?.mastodon_handle]);
  if (!hub.plugins.enabled("fediverse") || !user) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await setMastodonHandle(value);
      updateUser({ ...user, mastodon_handle: r.mastodon_handle });
      setValue(r.mastodon_handle ?? "");
      setMessage(r.mastodon_handle ? "Saved." : "Cleared. Share on Mastodon will ask again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel" id="mastodon" data-anchor="">
      <h3>Mastodon</h3>
      <p className="form-hint">
        Share on Mastodon opens your server with this. It's yours: nobody else sees it.
      </p>
      <form onSubmit={save}>
        <label htmlFor={id} className="visually-hidden">
          Your Mastodon handle
        </label>
        <input
          id={id}
          className="form-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          placeholder="@name@mastodon.social"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          style={{ maxWidth: "32ch" }}
        />{" "}
        <button type="submit" className="btn-secondary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      {message && <p className="settings-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
