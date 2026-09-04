import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicVoteResults, type PublicVoteResults } from "../services/api";
import { relativeTime, absoluteTime } from "../components/FeedPost";
import PostFeaturedImage from "../components/PostFeaturedImage";
import LinkPreviewCard from "../components/LinkPreviewCard";
import hub from "../config/hub";
import ShareButton from "../components/ShareButton";
import "./VoteResults.css";

const URL_RE = /\bhttps?:\/\/\S+/gi;

/**
 * Public Vote Results page. Renamed from Brief.tsx in Slice 8.5 and
 * restructured top-to-bottom to match the slice's layout:
 *
 *   1. Heading: "Vote results: <title>"
 *   2. Delivery indicator: "Delivered to the Board of Supervisors on
 *      <date>"
 *   3. About this vote: snapshotted description, options, voting window
 *      — with a graceful fallback for legacy records that lack
 *      `vote_context`
 *   4. Results: positions with bars
 *   5. What residents said: comments (hidden if none)
 *   6. Notes from the Civic Hub: admin_notes (hidden if empty)
 *   7. Provenance footer
 */
export default function VoteResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [results, setResults] = useState<PublicVoteResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getPublicVoteResults(id)
      .then((r) => {
        if (cancelled) return;
        setResults(r);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page vote-results-page">
        <p className="vote-results-status">Loading vote results…</p>
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="page vote-results-page">
        <p className="vote-results-status vote-results-status-error">
          {error ?? "Vote results not found."}
        </p>
      </div>
    );
  }

  const ctx = results.vote_context;

  // Delivery line — uses approved_at because that's when the email
  // actually went out to the Board. Legacy records may not have it
  // populated; fall back to a date-less line and don't surface
  // recipient emails publicly.
  const deliveryLine = (() => {
    if (results.approved_at) {
      const d = new Date(results.approved_at);
      const dateLabel = d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      return `Delivered to the ${hub.governing_body_name} on ${dateLabel}.`;
    }
    return `Delivered to the ${hub.governing_body_name}.`;
  })();

  return (
    <article className="page vote-results-page">

      <div className="process-share-row">
        <ShareButton
          title={results.title}
          nudge={{ processId: id!, text: "Share the result so more neighbors see what came of it." }}
          shareText={`Vote results: ${results.title}`}
        />
      </div>

      <header className="vote-results-header">
        <p className="vote-results-eyebrow">Vote results</p>
        <h1>Vote results: {results.title}</h1>
        <p className="vote-results-meta">
          Published{" "}
          <time
            dateTime={results.published_at}
            title={absoluteTime(results.published_at)}
          >
            {relativeTime(results.published_at)}
          </time>{" "}
          ·{" "}
          <Link
            to={`/process/${results.source_process_id}`}
            className="inline-link"
          >
            view original vote
          </Link>
        </p>
      </header>

      <aside className="vote-results-delivery" aria-label="Delivery indicator">
        {deliveryLine}
      </aside>

      {results.image_url && (
        <PostFeaturedImage
          src={results.image_url}
          alt={results.image_alt ?? ""}
        />
      )}

      <section className="vote-results-section">
        <h2>About this vote</h2>
        {ctx ? (
          <>
            {ctx.description && (
              <div className="vote-results-description">
                {ctx.description.split(/\n\n+/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            )}

            {/* Structured content sections (Background, Key
                considerations, etc.) snapshotted from the original vote. */}
            {ctx.content?.sections && ctx.content.sections.length > 0 && (
              <div className="vote-results-content-sections">
                {ctx.content.sections.map((section, i) => (
                  <div key={i} className="vote-results-content-block">
                    <h3 className="vote-results-subheading">{section.title}</h3>
                    {Array.isArray(section.body) ? (
                      <ul className="vote-results-options-list">
                        {section.body.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="vote-results-description">
                        {section.body.split(/\n\n+/).map((para, j) => (
                          <p key={j}>{para}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {ctx.content?.links && ctx.content.links.length > 0 && (
              <div className="vote-results-content-block">
                <h3 className="vote-results-subheading">Related links</h3>
                <ul className="vote-results-options-list">
                  {ctx.content.links.map((link, i) => (
                    <li key={i}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-link"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ctx.options.length > 0 && (
              <>
                <h3 className="vote-results-subheading">Options on the ballot</h3>
                <ul className="vote-results-options-list">
                  {ctx.options.map((o) => (
                    <li key={o.option_id}>{o.option_label}</li>
                  ))}
                </ul>
              </>
            )}
            {(ctx.starts_at || ctx.ends_at) && (
              <p className="vote-results-window">
                {formatVotingWindow(ctx.starts_at, ctx.ends_at)}
              </p>
            )}
          </>
        ) : (
          <p className="vote-results-context-missing">
            Original vote context not available for this earlier results page.
          </p>
        )}
      </section>

      <section className="vote-results-section">
        <h2>Results</h2>
        <p className="vote-results-participation">
          <strong>{results.participation_count}</strong>{" "}
          resident{results.participation_count === 1 ? "" : "s"} voted
          {ctx?.method === "approval" ? " (approval voting — each voter could approve multiple options)" : ""}.
        </p>
        <ul className="brief-bars">
          {results.position_breakdown.map((p) => (
            <li key={p.option_id} className="brief-bar-row">
              <div className="brief-bar-label">
                <span>{p.option_label}</span>
                <span className="brief-bar-count">
                  {p.count} ({p.percentage}%)
                </span>
              </div>
              <div className="brief-bar-track">
                <div
                  className="brief-bar-fill"
                  style={{ width: `${Math.min(p.percentage, 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {results.comments.length > 0 && (
        <section className="vote-results-section">
          <h2>What residents said</h2>
          <ul className="brief-comments-list">
            {results.comments.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {results.admin_notes.trim().length > 0 && (
        <section className="vote-results-section">
          <h2>Notes from the Civic Hub</h2>
          <p className="brief-admin-notes">{results.admin_notes}</p>
          {(() => {
            // Surface link previews for URLs in admin_notes — same
            // contract as Announcement.tsx. Plain links inside the
            // notes paragraph are still clickable; the preview cards
            // are an additive layer.
            const urls = Array.from(
              new Set(
                (results.admin_notes.match(URL_RE) ?? [])
                  .map((u) => u.replace(/[)\].,;!?]+$/, ""))
                  .filter((u) => u.length > 0),
              ),
            );
            if (urls.length === 0) return null;
            return (
              <div className="vote-results-link-previews">
                {urls.map((u) => (
                  <LinkPreviewCard key={u} url={u} />
                ))}
              </div>
            );
          })()}
        </section>
      )}


      <footer className="vote-results-provenance">
        Generated{" "}
        <time
          dateTime={results.generated_at}
          title={absoluteTime(results.generated_at)}
        >
          {relativeTime(results.generated_at)}
        </time>
        . Reviewed and approved by an admin.
      </footer>
    </article>
  );
}

function formatVotingWindow(
  startsAt: string | null,
  endsAt: string | null,
): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  if (startsAt && endsAt) return `Open from ${fmt(startsAt)} to ${fmt(endsAt)}.`;
  if (startsAt) return `Opened ${fmt(startsAt)}.`;
  if (endsAt) return `Closed ${fmt(endsAt)}.`;
  return "";
}
