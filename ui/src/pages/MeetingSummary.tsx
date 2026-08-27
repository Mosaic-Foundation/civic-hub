import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getMeetingSummary,
  type PublicMeetingSummary,
} from "../services/api";
import { relativeTime, absoluteTime } from "../components/FeedPost";
import ShareButton from "../components/ShareButton";
import AdminArchiveButton from "../components/AdminArchiveButton";
import "./MeetingSummary.css";
import RelatedProcesses from "../components/RelatedProcesses";

export default function MeetingSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<PublicMeetingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getMeetingSummary(id)
      .then((s) => {
        if (!cancelled) setSummary(s);
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
      <div className="page meeting-summary-page">
        <p className="meeting-status">Loading summary…</p>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="page meeting-summary-page">
        <p className="meeting-status meeting-status-error">
          {error ?? "This summary hasn't been published yet."}
        </p>
      </div>
    );
  }

  const hasVideo = summary.source_video_url !== null;
  const disclaimer = hasVideo
    ? "AI-generated, admin-reviewed. Not an authoritative transcript. Click a timestamp to jump to that moment on YouTube."
    : "AI-generated from minutes document only — no video recording available. Admin-reviewed. Not an authoritative transcript.";

  return (
    <article className="page meeting-summary-page">
      <div className="process-share-row">
        <ShareButton
          title={summary.meeting_title}
          shareText={`Meeting summary: ${summary.meeting_title}`}
        />
      </div>

      <header className="meeting-header">
        <p className="meeting-eyebrow">Meeting summary</p>
        <h1>
          {summary.meeting_title}
          {" — "}
          <time dateTime={summary.meeting_date}>
            {formatDate(summary.meeting_date)}
          </time>
        </h1>
        <p className="meeting-meta">
          Published{" "}
          <time
            dateTime={summary.published_at}
            title={absoluteTime(summary.published_at)}
          >
            {relativeTime(summary.published_at)}
          </time>
          {summary.revised_at && (
            <>
              {" · "}
              <span className="meeting-revised">
                Updated{" "}
                <time
                  dateTime={summary.revised_at}
                  title={absoluteTime(summary.revised_at)}
                >
                  {relativeTime(summary.revised_at)}
                </time>{" "}
                with the official minutes
              </span>
            </>
          )}
        </p>
      </header>

      {summary.awaiting_minutes && (
        // Readers otherwise wonder why a meeting record has no minutes link.
        // Jurisdictions approve minutes at the FOLLOWING meeting, so a gap of
        // several weeks is normal rather than an omission.
        <div className="meeting-pending-minutes">
          Official minutes for this meeting have not been published yet — they
          are usually approved at a later meeting. This summary is based on the
          meeting recording. It will be updated once the minutes are available.
        </div>
      )}

      <div className="meeting-disclaimer">
        <strong>{summary.ai_attribution_label}</strong>
        <span>{disclaimerDetail(disclaimer)}</span>
      </div>

      <div className="meeting-provenance">
        {summary.source_minutes_url ? (
          <a
            href={summary.source_minutes_url}
            target="_blank"
            rel="noopener noreferrer"
            className="meeting-chip"
          >
            View minutes PDF
          </a>
        ) : summary.source_agenda_url ? (
          <a
            href={summary.source_agenda_url}
            target="_blank"
            rel="noopener noreferrer"
            className="meeting-chip"
          >
            View agenda PDF
          </a>
        ) : null}
        {summary.source_video_url && (
          <a
            href={summary.source_video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="meeting-chip"
          >
            Watch recording
          </a>
        )}
        {summary.additional_video_urls.map((url, i) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="meeting-chip meeting-chip-secondary"
          >
            Recording (segment {i + 2})
          </a>
        ))}
      </div>

      {/* Sections collapse by default so the page opens as a scannable agenda
          of the whole meeting rather than a wall of prose. A four-hour meeting
          runs to a dozen-plus blocks; most readers want to find the one item
          they care about, not read all of it. Native <details> is used rather
          than hand-rolled state so keyboard and screen-reader behaviour, and
          the browser's own find-in-page expansion, come for free. */}
      <p className="meeting-blocks-help">
        Select a section to read its summary.
        {hasVideo
          ? " Select a timestamp to open the recording at that moment."
          : ""}
      </p>

      <section className="meeting-blocks">
        {summary.blocks.map((block, i) => (
          <details key={i} className="meeting-block">
            <summary className="meeting-block-header">
              <span className="meeting-block-heading">
                {block.start_time_seconds !== null && summary.source_video_url ? (
                  <a
                    href={youTubeAtTime(
                      summary.source_video_url,
                      block.start_time_seconds,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="meeting-block-timestamp"
                    // Without this the browser both follows the link and
                    // toggles the section, so jumping to the video would
                    // silently expand a block the reader never asked for.
                    onClick={(e) => e.stopPropagation()}
                  >
                    {formatSeconds(block.start_time_seconds)}
                  </a>
                ) : null}
                <h2 className="meeting-block-title">{block.topic_title}</h2>
              </span>
              {/* Grouped so the pair can move as a unit: beside the title on a
                  wide screen, onto its own row beneath it on a narrow one,
                  where competing for the same line starves the title. */}
              <span className="meeting-block-meta">
                {/* Votes and motions are what most residents come for, so they
                    stay findable without opening every section. */}
                {block.action_taken && (
                  <span className="meeting-block-flag">Action taken</span>
                )}
                <span className="meeting-block-caret" aria-hidden="true" />
              </span>
            </summary>
            <div className="meeting-block-body">
              <p className="meeting-block-summary">{block.topic_summary}</p>
              {block.action_taken && (
                <p className="meeting-block-action">
                  <strong>Action taken:</strong> {block.action_taken}
                </p>
              )}
            </div>
          </details>
        ))}
      </section>

      {summary.admin_notes.trim().length > 0 && (
        <section className="meeting-notes">
          <h2>Notes from the Civic Hub</h2>
          <p>{summary.admin_notes}</p>
        </section>
      )}

      {/* Admin-only: archive a stale/incorrect summary (soft-remove,
          restorable from the admin Archived view). Renders nothing for
          non-admins. */}
      {id && (
        <AdminArchiveButton
          processId={id}
          itemLabel="meeting summary"
          onArchived={() => navigate("/")}
        />
      )}

      {/* Read-only. A process may link TO this post, and the counter-link
          renders here so a reader can follow it back — but content posts
          never originate links of their own. */}
      <RelatedProcesses processId={id!} readOnly />
    </article>
  );
}

function disclaimerDetail(full: string): string {
  // Show only the post-first-sentence detail so the <strong> carries the
  // attribution label and the detail line carries the "not authoritative"
  // copy. Everything after the first period is the detail.
  const idx = full.indexOf(".");
  if (idx < 0) return full;
  return full.slice(idx + 1).trim();
}

function youTubeAtTime(watchUrl: string, seconds: number): string {
  // Preserve the v= param and append t=<n>s (YouTube accepts both ?t=NNs
  // and fragment #t=NNs; ?t=NNs is consistent across watch and livestream
  // URLs).
  try {
    const u = new URL(watchUrl);
    u.searchParams.set("t", `${Math.max(0, Math.floor(seconds))}s`);
    return u.toString();
  } catch {
    return watchUrl;
  }
}

function formatDate(iso: string): string {
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

