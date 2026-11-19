import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { Button } from "../kit";
import AboutYouForm from "./AboutYouForm";
import { formStateFrom, inputFrom, type AboutFormState } from "./aboutYouState";
import { useAboutConfig } from "../hooks/useAboutConfig";
import { useHub } from "../config/hub";
import {
  markAboutAsked,
  noteAboutAsked,
  saveAbout,
  setAboutYouPrompt,
} from "../services/aboutYou";

/**
 * The one-time "About you" card (districts and demographics, 2026-11-16).
 * Mounted once in App. The first time a signed-in member takes part in
 * anything, api.ts waits on askAboutYouFirst(), which opens this card; the
 * action goes on when it closes, whatever they answered. Showing it records
 * that they were asked, so it never shows again. Never during sign-up: a new
 * account is first asked after the onboarding word cloud (services/aboutYou.ts).
 */
export default function AboutYouCard() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AboutFormState>(() => formStateFrom(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(false);
  const resolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setAboutYouPrompt(
      () =>
        new Promise<void>((resolve) => {
          resolveRef.current = resolve;
          setState(formStateFrom(null));
          setError(null);
          setOpen(true);
          noteAboutAsked();
          // Recorded as soon as it shows: asked once, whatever happens next.
          markAboutAsked().catch(() => undefined);
        }),
    );
    return () => setAboutYouPrompt(null);
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(false), 6000);
    return () => window.clearTimeout(t);
  }, [note]);

  const finish = useCallback((saved: boolean) => {
    setOpen(false);
    setSaving(false);
    if (!saved) setNote(true);
    resolveRef.current?.();
    resolveRef.current = null;
  }, []);

  const config = useAboutConfig();
  const hub = useHub();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveAbout(inputFrom(state, config));
      finish(true);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Could not save. You can skip this and add it later in Settings.");
    }
  }

  return (
    <>
      {open && (
        <Modal title="Before you go on: about you" onClose={() => finish(false)} dismissible={!saving} closeLabel="Skip">
          <p className="form-hint about-card-why">
            So {hub.governing_body_ref} can see what people in each {config.term.singular.toLowerCase()} think.
            Only you can see your answers; results only show totals.
          </p>
          <AboutYouForm config={config} state={state} onChange={setState} disabled={saving} />
          {error && <p className="form-error">{error}</p>}
          <div className="about-card-actions">
            <Button variant="ghost" onClick={() => finish(false)} disabled={saving}>
              Skip
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save and continue"}
            </Button>
          </div>
        </Modal>
      )}
      {note && (
        <p className="about-card-note" role="status">
          You can add this any time in Settings.
        </p>
      )}
    </>
  );
}
