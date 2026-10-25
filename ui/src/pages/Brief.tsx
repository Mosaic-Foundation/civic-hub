import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { ClosedEarlyNote } from "../components/CloseEarly";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  getPublicBrief,
  postBriefResponse,
  type PublicBrief,
} from "../services/api";
import { absoluteDate, absoluteTime } from "../utils/dates";
import PostFeaturedImage from "../components/PostFeaturedImage";
import ProcessHeader from "../components/ProcessHeader";
import DetailActions from "../components/DetailActions";
import { BriefSourcePointer } from "../components/BriefPointer";
import ShareButton from "../components/ShareButton";
import hub from "../config/hub";
import { useAction } from "../hooks/useAction";
import { useAuth } from "../context/AuthContext";
import { authorBadges } from "../../../src/shared/officialTypes";
// Reuse the vote-results public styling — same page language.
import "./VoteResults.css";
import "./Brief.css";
import RelatedProcesses from "../components/RelatedProcesses";
import { heldBackLine, joinNames } from "../services/briefDelivery";
import AdminArchiveButton from "../components/AdminArchiveButton";
import { manifestOf, typeName } from "../processes/display";

// The noun for the source process: its type's name, lowercased, for a type a
// brief is made for; anything else is a "process".
function sourceNoun(type: string): string {
  return manifestOf(type)?.descriptor.brief ? typeName(type).toLowerCase() : "process";
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
  const {
    data: brief,
    loading,
    error,
    setData: setBrief,
  } = useApi<PublicBrief>(id ? `brief/${id}` : null, () => getPublicBrief(id!));
  const [responseDraft, setResponseDraft] = useState("");
  const post = useAction("Could not post the response.");
  const posting = post.busy;
  const postError = post.error;

  async function submitResponse() {
    if (!id) return;
    await post.run(async () => {
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
    });
  }

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
          {error?.message ?? "Brief not found."}
        </p>
        <Link to="/" className="back-link">
          &larr; Home
        </Link>
      </div>
    );
  }

  const noun = sourceNoun(brief.source_process_type);

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
        sample={Boolean(brief.is_sample)}
        aside={
          <ShareButton
            title={`Civic Brief: ${brief.title}`}
            nudge={{
              processId: id!,
              text: "Share the brief so more neighbors see what came of it.",
            }}
          />
        }
      />

      {/* Where this came from — the pair the links API derives from
          source_process_id, surfaced at the top instead of only in the
          Related panel at the bottom. */}
      <BriefSourcePointer processId={id!} />

      <p className="vote-results-headline">{brief.headline}</p>

      {/* Its source closed before the deadline: the line and the admin's note. */}
      <ClosedEarlyNote closedEarly={brief.closed_early} />

      {/* Delivery receipt. Briefs whose review selected named recipients
          show WHO (their public display labels — never emails) and WHEN
          (the actual send time). Legacy deliveries recorded no labels and
          keep the governing-body wording. */}
      {brief.sent_to.length > 0 && brief.delivered_at ? (
        <p className="vote-results-delivery">
          Sent to {joinNames(brief.sent_to)} on{" "}
          <time dateTime={brief.delivered_at} title={absoluteTime(brief.delivered_at)}>
            {absoluteDate(brief.delivered_at)}
          </time>
          .
        </p>
      ) : brief.delivered_recipient_count > 0 && brief.approved_at && hub.governing_body_short ? (
        // No governing body (a non-place hub) means no "delivered to" line
        // (review R29, 2026-10-07).
        <p className="vote-results-delivery">
          Delivered to the {hub.governing_body_name || hub.governing_body_short} on{" "}
          {absoluteDate(brief.approved_at)}
          .
        </p>
      ) : null}
      {/* Addressed, but the hub held the email back (demo or beta, sample). */}
      {heldBackLine(brief) && <p className="vote-results-delivery">{heldBackLine(brief)}</p>}

      {/* Response status as a single prominent affordance. It names no
          responder — any official may respond, not only the recipients,
          so the old "from the Board of Supervisors" note is gone. While
          awaiting it is a plain status; once an official is on the record
          below it becomes a button that jumps down to the responses. */}
      <div className="brief-response-cta">
        {brief.response_status === "responded" && brief.responses.length > 0 ? (
          <a
            href="#brief-responses"
            className="brief-response-cta-btn brief-response-cta-btn--responded"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById("brief-responses");
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.focus();
              }
            }}
          >
            {brief.responses.length > 1 ? "See responses" : "See response"}
          </a>
        ) : (
          <span
            className="brief-response-cta-btn brief-response-cta-btn--awaiting"
            role="status"
          >
            Awaiting response
          </span>
        )}
      </div>

      {brief.image_url && (
        <PostFeaturedImage src={brief.image_url} alt={brief.image_alt ?? ""} />
      )}

      {/* The Summary heading appears only when there is prose under it.
          A brief whose source process had no description would otherwise
          render "Summary" over nothing but the participation count, which
          reads as broken rather than empty. Participation still shows on its
          own in that case — it is a fact about the outcome, not a summary. */}
      {(summaryParagraphs.length > 0 || brief.participation_label) && (
        <section className="vote-results-section vote-results-section--summary">
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
          <h2>In {hub.noun(2)}&apos; words</h2>
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
          {absoluteDate(brief.published_at)}
        </time>
        {/* Regenerated after publishing: the same brief, a new version. */}
        {brief.revised_at && (
          <>
            {", updated "}
            <time dateTime={brief.revised_at} title={absoluteTime(brief.revised_at)}>
              {absoluteDate(brief.revised_at)}
            </time>
          </>
        )}
        .
      </p>

      {/* Official responses — the government's side of the record. The
          brief above is sealed; responses are appended alongside it,
          oldest first, each stamped with the office held at response
          time. Any official may respond, and may add a follow-up later —
          the record reads as correspondence, never as an edit. */}
      {(brief.responses.length > 0 || official) && (
        <section
          id="brief-responses"
          className="vote-results-section brief-responses"
          tabIndex={-1}
        >
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
                  {absoluteDate(r.created_at)}
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
