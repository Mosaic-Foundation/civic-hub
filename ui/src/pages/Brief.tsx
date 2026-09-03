import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  getPublicBrief,
  postBriefResponse,
  type PublicBrief,
} from "../services/api";
import { absoluteTime } from "../components/FeedPost";
import PostFeaturedImage from "../components/PostFeaturedImage";
import ProcessHeader from "../components/ProcessHeader";
import DetailActions from "../components/DetailActions";
import { BriefSourcePointer } from "../components/BriefPointer";
import ShareButton from "../components/ShareButton";
import hub from "../config/hub";
import { useAuth } from "../context/AuthContext";
import { authorBadges } from "../../../src/shared/officialTypes";
// Reuse the vote-results public styling — same page language.
import "./VoteResults.css";
import "./Brief.css";
import RelatedProcesses from "../components/RelatedProcesses";
import AdminArchiveButton from "../components/AdminArchiveButton";

const SOURCE_NOUN: Record<string, string> = {
  "civic.polis_deliberation": "conversation",
  "civic.proposal": "proposal",
  "civic.vote": "vote",
  "civic.project": "project",
};

/** "A" / "A and B" / "A, B, and C" — the receipt reads as a sentence. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Public Brief page — the permanent public record of a completed process.
 * Renders the outcome headline, summary, outcome sections, participation,
 * community comments, admin notes, and a delivery receipt. Served for
 * published civic.brief records only (pending/approved 404).
 */
export default function BriefPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { official, user } = useAuth();
  const [brief, setBrief] = useState<PublicBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function submitResponse() {
    if (!id || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const result = await postBriefResponse(id, responseDraft);
      setResponseDraft("");
      setBrief((prev) =>
        prev
          ? {
              ...prev,
              response_status: result.response_status,
              responded_at: result.responded_at,
              responses: result.responses,
            }
          : prev,
      );
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Could not post the response.");
    } finally {
      setPosting(false);
    }
  }

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

      <ProcessHeader
        type="civic.brief"
        title={brief.title}
        aside={<ShareButton title={`Civic Brief: ${brief.title}`} />}
      />

      {/* Where this came from — the pair the links API derives from
          source_process_id, surfaced at the top instead of only in the
          Related panel at the bottom. */}
      <BriefSourcePointer processId={id!} />

      <p className="vote-results-headline">{brief.headline}</p>

      {/* Delivery receipt. Briefs whose review selected named recipients
          show WHO (their public display labels — never emails) and WHEN
          (the actual send time). Legacy deliveries recorded no labels and
          keep the governing-body wording. */}
      {brief.sent_to.length > 0 && brief.delivered_at ? (
        <p className="vote-results-delivery">
          Sent to {joinNames(brief.sent_to)} on{" "}
          <time dateTime={brief.delivered_at}>
            {absoluteTime(brief.delivered_at)}
          </time>
          .
        </p>
      ) : brief.delivered_recipient_count > 0 && brief.approved_at ? (
        <p className="vote-results-delivery">
          Delivered to the {hub.governing_body_name} on{" "}
          {new Date(brief.approved_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          .
        </p>
      ) : null}

      {/* Response status — a neutral invitation, not a callout. "Awaiting"
          states a fact and what will appear; it names no one and sets no
          deadline. Flips to "Responded" (anchored to the FIRST response's
          date) the moment an official goes on the record below. */}
      <p className="brief-response-status-row">
        {brief.response_status === "responded" && brief.responded_at ? (
          <span className="brief-response-status brief-response-status--responded">
            Responded{" "}
            {new Date(brief.responded_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        ) : (
          <>
            <span className="brief-response-status brief-response-status--awaiting">
              Awaiting response
            </span>
            <span className="brief-response-status-note">
              {brief.delivered_recipient_count > 0
                ? `A public response from the ${hub.governing_body_name} will appear here when one is posted.`
                : "A public response from an official will appear here when one is posted."}
            </span>
          </>
        )}
      </p>

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

      {/* Official responses — the government's side of the record. The
          brief above is sealed; responses are appended alongside it,
          oldest first, each stamped with the office held at response
          time. Any official may respond, and may add a follow-up later —
          the record reads as correspondence, never as an edit. */}
      {(brief.responses.length > 0 || official) && (
        <section className="vote-results-section brief-responses">
          <h2>
            {brief.responses.length > 1
              ? "Official responses"
              : "Official response"}
          </h2>

          {brief.responses.map((r) => (
            <article key={r.id} className="brief-response">
              <header className="brief-response-header">
                <span className="brief-response-author">{r.responder_name}</span>
                {authorBadges({
                  officialType: r.official_type,
                  officialTitle: r.official_title,
                }).map((badge) => (
                  <span key={badge.kind} className={badge.className}>
                    {badge.text}
                  </span>
                ))}
                <time
                  className="brief-response-date"
                  dateTime={r.created_at}
                  title={absoluteTime(r.created_at)}
                >
                  {new Date(r.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </time>
              </header>
              <p className="brief-response-body" style={{ whiteSpace: "pre-wrap" }}>
                {r.body}
              </p>
            </article>
          ))}

          {official && (
            <div className="brief-response-form">
              <label htmlFor="brief-response-input">
                {brief.responses.length > 0
                  ? "Add a follow-up response"
                  : "Post a public response"}
              </label>
              <textarea
                id="brief-response-input"
                value={responseDraft}
                onChange={(e) => setResponseDraft(e.target.value)}
                rows={5}
                maxLength={5000}
                placeholder="Your response to this brief…"
                disabled={posting}
              />
              <p className="brief-response-form-note">
                Posting publicly as {user?.full_name || user?.display_name || "you"}{" "}
                — {official.title}. Responses are part of the permanent public
                record and cannot be edited; post a follow-up to add to them.
              </p>
              {postError && (
                <p className="brief-response-form-error">{postError}</p>
              )}
              <button
                type="button"
                onClick={submitResponse}
                disabled={posting || responseDraft.trim().length === 0}
              >
                {posting ? "Posting…" : "Post public response"}
              </button>
            </div>
          )}
        </section>
      )}

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
      <DetailActions>
        <AdminArchiveButton
          processId={id!}
          itemLabel="brief"
          onArchived={() => navigate("/outcomes")}
        />
      </DetailActions>
    </div>
  );
}
