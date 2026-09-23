// Render a markdown-backed legal page (Privacy Policy, Terms of
// Service, Code of Conduct) served by the hub.
//
// The document comes from the server, not the bundle. It used to be a
// `?raw` import, which compiled one hub's terms into a build that now
// serves several — see useHubDocument for why that had to go. This
// component therefore renders three states, not one: loading, the
// document, and "this hub has not published one".
//
// Internal cross-links between the documents (e.g. /code-of-conduct
// from /terms) route through React Router instead of triggering a full
// page load — a CustomLink mapped onto react-markdown's anchor renderer
// handles that.
//
// Placeholders the server could not fill (`{GOVERNING_BODY}` on a hub
// that has not named one) are rendered verbatim, deliberately: they are
// impossible to miss in review, and a sentence with a visible hole is
// better than a sentence with an invisible one.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hub from "../config/hub";
import type { HubDocument } from "../hooks/useHubDocument";
import "./LegalPage.css";

interface Props {
  /** The hub's document, in whichever of its three states it is in. */
  document: HubDocument;
  /** Document title — the browser tab title and the fallback heading. */
  title: string;
}

/**
 * Custom anchor renderer. URLs that start with "/" are treated as
 * internal routes and rendered with React Router's <Link> so a click
 * doesn't trigger a full reload. Mailto links keep the default mail
 * handler. Everything else opens in a new tab with rel safety attrs.
 */
function CustomLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  if (!href) return <a>{children}</a>;
  if (href.startsWith("/")) {
    return <Link to={href}>{children}</Link>;
  }
  if (href.startsWith("mailto:")) {
    return <a href={href}>{children}</a>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function LegalPage({ document: doc, title }: Props) {
  // Set the document title so the legal page is identifiable in the
  // browser tab. We don't reset on unmount — React Router's next page
  // will overwrite it if it cares.
  useEffect(() => {
    document.title = `${title} · ${hub.name}`;
  }, [title]);

  return (
    <article className="page legal-page">
      <Link to="/" className="back-link">
        &larr; Home
      </Link>
      <div className="legal-prose">
        {doc.status === "ready" ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ a: CustomLink }}
          >
            {doc.markdown}
          </ReactMarkdown>
        ) : doc.status === "loading" ? (
          <p className="legal-page-status">Loading…</p>
        ) : (
          <>
            <h1>{title}</h1>
            <p className="legal-page-status">
              {hub.name} has not published this document yet.
            </p>
            {hub.contact_email && (
              <p className="legal-page-status">
                For questions in the meantime, contact{" "}
                <a href={`mailto:${hub.contact_email}`}>{hub.contact_email}</a>.
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
