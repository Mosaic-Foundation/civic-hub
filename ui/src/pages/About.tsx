// What this hub is — served, not compiled in.
//
// This was 134 lines of hardcoded prose that named one county four times,
// while `copy.about` existed as a settings key with an override path and no
// default. So a hub that authored an About page had it stored and never
// rendered: Athens wrote one in the seed and the app went on showing Floyd's.
//
// The prose itself turned out not to be Floyd's at all. It describes what a
// Civic Hub IS — the process, what it is not, how results are used — which is
// the same everywhere, with a name and a place dropped in. So it became a
// shared template like the legal documents (config/legal/about.md), and the
// four literals became substitutions. A hub that wants to say something
// different overrides it, which is what Athens does.
//
// The welcome-reset control stays in the page: it is a button, not prose.

import { useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hub from "../config/hub";
import { clearIntroSeen } from "../components/IntroPopup";
import { useHubDocument } from "../hooks/useHubDocument";
import "../components/LegalPage.css";

export default function About() {
  const [introCleared, setIntroCleared] = useState(false);
  const doc = useHubDocument("copy.about");

  function handleShowWelcomeAgain() {
    clearIntroSeen();
    setIntroCleared(true);
  }

  return (
    <div className="page about-page">
      <Link to="/" className="back-link">&larr; Home</Link>

      <div className="legal-prose">
        {doc.status === "ready" ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {doc.markdown}
          </ReactMarkdown>
        ) : doc.status === "loading" ? (
          <p className="legal-page-status">Loading…</p>
        ) : (
          <>
            <h1>About {hub.name}</h1>
            <p className="legal-page-status">
              This hub has not published an About page yet.
            </p>
          </>
        )}
      </div>

      <p className="about-welcome-reset">
        {introCleared ? (
          <span>Welcome will reappear next time you visit the home page.</span>
        ) : (
          <button
            type="button"
            className="about-welcome-reset-button"
            onClick={handleShowWelcomeAgain}
          >
            Show me the welcome again
          </button>
        )}
      </p>
    </div>
  );
}
