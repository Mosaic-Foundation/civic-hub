// "Set up your hub" on the home page (pilot readiness 2, Adam 2026-11-02): for
// a signed-in admin it takes the place of the visitor's welcome card, until this
// admin dismisses it. The ticks come from the hub's state on the server
// (src/services/modeReadiness.ts, setupChecklist); Dismiss and Skip are stored
// on the admin's own account, so every later admin sees it too.
//
// Pilot readiness 3 (Adam, 2026-11-06): short. "View your setup checklist" to
// Hub settings → Getting started, and Dismiss. The rail's "Setup guide" is the
// permanent way back. After his walk the same day: no steps listed, only how
// many of the checklist's are done ("4 of 11"), with a bar.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../kit/Button";
import { SETUP_CHECKLIST_PATH } from "../../../src/shared/adminAnchors";
import { adminGetSetupCard, adminPostSetupCard, type SetupCard } from "../services/api";
import "./AdminSetupCard.css";

export default function AdminSetupCard() {
  const [card, setCard] = useState<SetupCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminGetSetupCard()
      .then((c) => {
        if (live) setCard(c);
      })
      // The card is a help, not the page: without it the rail's Setup guide stays.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!card || card.dismissed) return null;

  const total = card.checklist.length;
  const done = card.checklist.filter((s) => s.done).length;

  function dismiss() {
    setError(null);
    adminPostSetupCard("dismiss")
      .then(setCard)
      .catch(() => setError("That didn't save. Try again in a moment."));
  }

  return (
    <section className="setup-card" aria-labelledby="setup-card-title">
      <h2 id="setup-card-title" className="setup-card-title">
        Set up your hub
      </h2>
      <p className="setup-card-body">
        The steps tick themselves as you go, and what you've saved stays, so there's no need to do it all in one sitting.
      </p>
      <p className="setup-card-count" id="setup-card-count">
        <strong>{done} of {total}</strong> steps done
      </p>
      <progress className="setup-card-meter" max={total} value={done} aria-labelledby="setup-card-count" />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="setup-card-actions">
        <Link className="btn-primary" to={SETUP_CHECKLIST_PATH}>
          View your setup checklist
        </Link>
        <Button variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
