import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { getPublicBrief, type PublicBrief } from "../services/api";
import { absoluteTime } from "../components/FeedPost";
import PostFeaturedImage from "../components/PostFeaturedImage";
import ShareButton from "../components/ShareButton";
import hub from "../config/hub";
// Reuse the vote-results public styling — same page language.
import "./VoteResults.css";
import RelatedProcesses from "../components/RelatedProcesses";
import AdminArchiveButton from "../components/AdminArchiveButton";

const SOURCE_NOUN: Record<string, string> = {
  "civic.polis_deliberation": "conversation",
  "civic.proposal": "proposal",
  "civic.vote": "vote",
  "civic.project": "project",
};

/**
 * Public Brief page — the permanent public record of a completed process.
 * Renders the outcome headline, summary, outcome sections, participation,
 * community comments, admin notes, and a delivery receipt. Served for
 * published civic.brief records only (pending/approved 404).
 */
export default function BriefPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [brief, setBrief] = useState<PublicBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getPublicBrief(id)
      .then((b) => {
        if (!cancelled) setBrief(b);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page vote-results-page">
        <p className="vote-results-status">Loading brief…</p>
      </div>
    );
  }

  if (error || !brief) {
    return (
      <div className="page vote-results-page">
        <p className="vote-results-status">
          {error ?? "Brief not found."}
        </p>
        <Link to="/" className="back-link">
          &larr; Home
        </Link>
      </div>
    );
  }

  const noun = SOURCE_NOUN[brief.source_process_type] ?? "process";

  // Split once, so the render can ask whether there is anything to show
  // before committing to a heading.
  const summaryParagraphs = (brief.summary ?? "")
    .split(/\n\n+/)
    .filter((para) => para.trim().length > 0);

  return (
    <div className="page vote-results-page">
      <Link to="/" className="back-link">
        &larr; Home
      </Link>

      <div className="vote-results-header-row">
        <h1 className="vote-results-title">{brief.title}</h1>
        <ShareButton title={`Civic Brief: ${brief.title}`} />
      </div>

      <p className="vote-results-headline">{brief.headline}</p>

      {brief.delivered_recipient_count > 0 && brief.approved_at && (
        <p className="vote-results-delivery">
          Delivered to the {hub.governing_body_name} on{" "}
          {new Date(brief.approved_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          .
        </p>
      )}

      {brief.image_url && (
        <PostFeaturedImage src={brief.image_url} alt={brief.image_alt ?? ""} />
      )}

      {/* The Summary heading appears only when there is prose under it.
          A brief whose source process had no description would otherwise
          render "Summary" over nothing but the participation count, which
          reads as broken rather than empty. Participation still shows on its
          own in that case — it is a fact about the outcome, not a summary. */}
      {(summaryParagraphs.length > 0 || brief.participation_label) && (
        <section className="vote-results-section">
          {summaryParagraphs.length > 0 && <h2>Summary</h2>}
          {summaryParagraphs.map((para, i) => (
            <p key={i} style={{ whiteSpace: "pre-wrap" }}>
              {para}
            </p>
          ))}
          {brief.participation_label && (
            <p className="vote-results-participation">{brief.participation_label}</p>
          )}
        </section>
      )}

      {brief.sections.map((s, i) => (
        <section key={i} className="vote-results-section">
          <h2>{s.heading}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{s.body}</p>
        </section>
      ))}

      {brief.comments.length > 0 && (
        <section className="vote-results-section">
          <h2>In residents' words</h2>
          <ul className="vote-results-comments">
            {brief.comments.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {brief.admin_notes.trim() && (
        <section className="vote-results-section">
          <h2>Notes from the {hub.name}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{brief.admin_notes}</p>
        </section>
      )}

      <p className="vote-results-provenance">
        This brief is the final record of a completed {noun} on the{" "}
        {hub.name}, published{" "}
        <time dateTime={brief.published_at} title={absoluteTime(brief.published_at)}>
          {new Date(brief.published_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        .
      </p>

      {/* Linking is the one thing that stays open on a brief. The brief's
          CONTENT is a sealed record; its relationships are navigation, and
          they belong below it as a separate capability. The panel also shows
          the pair derived from state.source_process_id and the links of the
          process this brief summarizes, so the permanent record carries the
          whole thread. */}
      <RelatedProcesses
        processId={id!}
        title={brief.title}
        description=""
        processType="civic.brief"
      />

      {/* Admin-only soft-remove. A brief is a permanent public record, so
          this is for taking down content that should not be public — it is
          restorable from the Archived tab, and an archived brief drops out of
          Outcomes and the feed automatically. */}
      <AdminArchiveButton
        processId={id!}
        itemLabel="brief"
        onArchived={() => navigate("/outcomes")}
      />
    </div>
  );
}
