import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/authState";
import { Button } from "../kit";
import AboutYouForm from "./AboutYouForm";
import { formStateFrom, inputFrom, type AboutFormState } from "./aboutYouState";
import { useAboutConfig } from "../hooks/useAboutConfig";
import { getAbout, noteAboutAsked, saveAbout } from "../services/aboutYou";
import { asksAnything } from "../../../src/shared/aboutYou";

/**
 * Settings > About you (districts and demographics, 2026-11-16): the
 * member's own answers, to add, change or clear. Shown when the hub asks
 * anything. Nobody else sees them.
 */
export default function AboutYouSetting() {
  const { user } = useAuth();
  const config = useAboutConfig();
  const on = Boolean(user) && asksAnything(config);
  const [state, setState] = useState<AboutFormState | null>(null);
  const [busy, setBusy] = useState(false);
  // Nothing changed since loading or the last save: the button says Saved and rests (Adam, 2026-11-17).
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    let live = true;
    getAbout()
      .then((r) => live && setState(formStateFrom(r.answers)))
      .catch(() => live && setError("Could not load your answers."));
    return () => {
      live = false;
    };
  }, [on]);

  if (!on) return null;

  async function save() {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const r = await saveAbout(inputFrom(state, config));
      setState(formStateFrom(r.answers));
      noteAboutAsked();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel" id="about-you" data-anchor="">
      <h3>About you</h3>
      <p className="form-hint">
        Only you can see these answers. Results only show totals for each {config.term.singular.toLowerCase()} or
        group, and hide any group of fewer than 5 people. Every answer is optional, and deleting your account deletes
        them.
      </p>
      <p className="form-hint">
        Your ballots carry your {config.term.singular.toLowerCase()} and age group, never your name. Someone holding a
        copy of the hub's database could work out how you voted if you were the only voter in your{" "}
        {config.term.singular.toLowerCase()} or age group. <Link to="/privacy">More in the Privacy Policy</Link>.
      </p>
      {state ? (
        <>
          <AboutYouForm
            config={config}
            state={state}
            onChange={(next) => {
              setState(next);
              setSaved(false);
            }}
            disabled={busy}
          />
          <div className="about-card-actions" style={{ justifyContent: "flex-start" }}>
            <Button variant="primary" onClick={() => void save()} disabled={busy || saved}>
              {busy ? (
                "Saving…"
              ) : saved ? (
                <>
                  <span aria-hidden="true">✓ </span>Saved
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </>
      ) : (
        !error && <p className="form-hint">Loading…</p>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
