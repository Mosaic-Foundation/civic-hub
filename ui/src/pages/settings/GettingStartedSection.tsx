// Hub settings → Getting started (pilot readiness 3, Adam 2026-11-06): the
// whole setup checklist, first in Hub settings. Each step has its tick, filled
// from the hub's own state (GET /admin/hub/setup-card, setupChecklist), a link
// to where it is set, and a link to its page on docs.civic.social (the help
// registry's anchors). The home page's card shows the first four and links
// here, and so does the rail's "Setup guide".

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import HelpButton from "../../components/HelpButton";
import { Button } from "../../kit/Button";
import { adminGetSetupCard, adminPostSetupCard, type SetupStep } from "../../services/api";
import { helpEntry, helpUrl } from "../../../../src/shared/helpRegistry";

export default function GettingStartedSection() {
  const [steps, setSteps] = useState<SetupStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminGetSetupCard()
      .then((c) => live && setSteps(c.checklist))
      .catch(() => live && setError("The checklist could not be loaded. Try again in a moment."));
    return () => {
      live = false;
    };
  }, []);

  function skip() {
    setError(null);
    adminPostSetupCard("skip_second_admin")
      .then((c) => setSteps(c.checklist))
      .catch(() => setError("That didn't save. Try again in a moment."));
  }

  const done = steps?.filter((s) => s.done).length ?? 0;
  const guide = helpEntry("admin.setup_guide");

  return (
    <section className="settings-section getting-started">
      <h2 className="settings-section-title">
        Getting started
        <HelpButton k="settings.getting-started" label="Getting started" />
      </h2>
      <p className="settings-section-intro">
        Everything that makes this hub yours, in the order most admins do it. Each step ticks itself when it's done, and
        what you've saved stays, so there's no need to do it all in one sitting.
        {guide && (
          <>
            {" "}
            <a href={helpUrl(guide)} target="_blank" rel="noopener">
              The setup guide
            </a>{" "}
            walks through it.
          </>
        )}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!steps ? (
        !error && <p className="form-hint">Loading…</p>
      ) : (
        <>
          <p className="getting-started-progress" aria-live="polite">
            {done} of {steps.length} done
          </p>
          <ol className="getting-started-list">
            {steps.map((s) => {
              const help = helpEntry(s.help);
              return (
                <li key={s.id} className={`getting-started-step${s.done ? " is-done" : ""}`} data-step={s.id}>
                  <span className="getting-started-tick" aria-hidden="true">
                    {s.done ? "✓" : ""}
                  </span>
                  <div className="getting-started-text">
                    <Link to={s.link} className="getting-started-label">
                      {s.label}
                    </Link>
                    <span className="visually-hidden">{s.done ? " (done)" : " (not done yet)"}</span>
                    <span className="getting-started-hint">
                      {s.hint}
                      {s.skipped && " You skipped this."}
                    </span>
                  </div>
                  <div className="getting-started-actions">
                    {s.can_skip && !s.done && (
                      <Button variant="ghost" size="sm" onClick={skip}>
                        Skip
                      </Button>
                    )}
                    {help && (
                      <a className="getting-started-docs" href={helpUrl(help)} target="_blank" rel="noopener">
                        Read about it<span className="visually-hidden">: {s.label}</span>
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
