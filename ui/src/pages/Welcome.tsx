// The hub's introduction — "what this is, what it isn't, where it could go".
//
// This page used to render a markdown file compiled into the bundle, with a
// download link to one hub's PDF and one hub's contact address hardcoded
// beside it. On a deployment serving several hubs that is another hub's
// personal essay under this hub's name, so the essay became a document
// (`copy.welcome`) and the two hardcoded links moved into it: a hub that has
// a PDF links to it from its own text, and the contact address is the hub's
// own `legal.contact_email`.
//
// There is no shared template. An introduction is written by whoever runs the
// hub or it does not exist, and a hub without one says so.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hub from "../config/hub";
import { useHubDocument } from "../hooks/useHubDocument";
import "../components/LegalPage.css";
import "./Welcome.css";

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

export default function Welcome() {
  const doc = useHubDocument("copy.welcome");

  useEffect(() => {
    document.title = `Welcome · ${hub.name}`;
  }, []);

  return (
    <article className="page legal-page welcome-page">
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
            <h1>Welcome to {hub.name}</h1>
            <p className="legal-page-status">
              This hub has not published an introduction yet.{" "}
              <Link to="/">Have a look around instead.</Link>
            </p>
          </>
        )}
      </div>
    </article>
  );
}
