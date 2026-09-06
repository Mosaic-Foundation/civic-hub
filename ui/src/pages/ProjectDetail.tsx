import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  getProjectDetail,
  setProjectSentiment,
  addProjectUpdate,
  addProjectComment,
  listProjectComments,
  completeProject,
  type ProjectDetail as ProjectDetailType,
  type ProjectComment,
  type SentimentValue,
} from "../services/api";

import ShareButton from "../components/ShareButton";
import ShareMoment from "../components/ShareMoment";
import Creator from "../components/Creator";
import RelatedProcesses from "../components/RelatedProcesses";
import { BriefPointer } from "../components/BriefPointer";
import "./ProjectDetail.css";
import AdminArchiveButton from "../components/AdminArchiveButton";
import DetailActions from "../components/DetailActions";
import { statusDisplay } from "../components/statusDisplay";
import ProcessHeader from "../components/ProcessHeader";
import MarkdownTextarea from "../components/MarkdownTextarea";
import RichText from "../components/RichText";
import EditHistory from "../components/EditHistory";
import { getEditPolicy, startProcessEdit, type EditPolicy } from "../services/api";
import SourceLinks from "../components/SourceLinks";

export default function ProjectDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  // Just saved an edit: say so plainly (it was never "submitted for review").
  const editedState =
    (location.state as { edited?: boolean; changed?: string[]; formatting?: string[] } | null) ?? null;
  // A toast that shows itself once after a save and goes away on its own
  // (Adam: not a bar you have to dismiss). The router state is cleared so a
  // reload or back-navigation does not replay it.
  // Captured ONCE: the router state is cleared right after mount, so the
  // message must not be re-derived from it on later renders.
  const [toastText] = useState<string | null>(() => {
    if (!editedState?.edited) return null;
    if (editedState.changed && editedState.changed.length > 0) return "Your project has been updated.";
    if (editedState.formatting && editedState.formatting.length > 0) return "Formatting updated.";
    return "Nothing changed, so nothing was saved.";
  });
  const [showEdited, setShowEdited] = useState(!!editedState?.edited);
  useEffect(() => {
    if (!editedState?.edited) return;
    navigate(location.pathname + location.hash, { replace: true, state: null });
    const t = window.setTimeout(() => setShowEdited(false), 4500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // While "See what changed" is open, the diff stands in for the description.
  const [historyOpen, setHistoryOpen] = useState(false);
  const { user, isAdmin } = useAuth();

  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [updateText, setUpdateText] = useState("");
  const [updatePosting, setUpdatePosting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentPosting, setCommentPosting] = useState(false);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  // "Edit project" — the server decides (creator or admin, active, what is
  // locked); we only ask when the viewer could plausibly be allowed. Hooks
  // live up here, above the loading/error returns, so their order is stable.
  const [editPolicy, setEditPolicy] = useState<EditPolicy | null>(null);
  const [editStarting, setEditStarting] = useState(false);
  const viewerIsCreator = project?.is_owner ?? (!!user?.id && user?.id === project?.user_id);
  const mayAsk = !!project && viewerIsCreator && project.status === "active";
  const projectId = project?.id;
  useEffect(() => {
    if (!mayAsk || !projectId) { setEditPolicy(null); return; }
    let cancelled = false;
    getEditPolicy(projectId)
      .then((p) => { if (!cancelled) setEditPolicy(p); })
      .catch(() => { if (!cancelled) setEditPolicy(null); });
    return () => { cancelled = true; };
  }, [mayAsk, projectId]);

  async function handleStartEdit() {
    if (!projectId) return;
    setEditStarting(true);
    try {
      const target = await startProcessEdit(projectId);
      navigate(target.draft_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the editor");
    } finally {
      setEditStarting(false);
    }
  }

  const loadProject = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await getProjectDetail(id);
      setProject(detail);
      const cmts = await listProjectComments(id);
      setComments(cmts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  async function handleSentiment(sentiment: SentimentValue | "neutral") {
    if (!id || sentimentLoading) return;
    setSentimentLoading(true);
    try {
      const result = await setProjectSentiment(id, sentiment);
      setProject((prev) =>
        prev
          ? {
              ...prev,
              support_count: result.support_count,
              oppose_count: result.oppose_count,
              user_sentiment: result.user_sentiment,
            }
          : prev,
      );
    } catch {
      // silently ignore — user can retry
    } finally {
      setSentimentLoading(false);
    }
  }

  function onSentimentClick(value: SentimentValue) {
    if (!project) return;
    if (project.user_sentiment === value) {
      handleSentiment("neutral");
    } else {
      handleSentiment(value);
    }
  }

  async function handlePostUpdate() {
    if (!id || !updateText.trim() || updatePosting) return;
    setUpdatePosting(true);
    try {
      await addProjectUpdate(id, updateText.trim());
      setUpdateText("");
      await loadProject();
    } catch {
      // silent
    } finally {
      setUpdatePosting(false);
    }
  }

  async function handlePostComment() {
    if (!id || !commentText.trim() || commentPosting) return;
    setCommentPosting(true);
    try {
      const comment = await addProjectComment(id, commentText.trim());
      setComments((prev) => [comment, ...prev]);
      setCommentText("");
    } catch {
      // silent
    } finally {
      setCommentPosting(false);
    }
  }

  if (loading) return <div className="section">Loading...</div>;
  if (error) return <div className="section error">Error: {error}</div>;
  if (!project) return <div className="section">Project not found</div>;

  // Ownership is decided server-side (is_owner) so the raw user_id is never
  // sent to the client; fall back to the id compare only if is_owner is absent.
  const isCreator = project.is_owner ?? (!!user?.id && user.id === project.user_id);
  const canComplete = (isCreator || isAdmin) && project.status === "active";

  async function handleComplete() {
    if (!id) return;
    if (
      !window.confirm(
        "Mark this project complete? This closes the project and creates a brief (its final results) for admin review.",
      )
    )
      return;
    setCompleting(true);
    setError(null);
    try {
      await completeProject(id);
      await loadProject();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to complete project");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="page detail-page">
      {project.banner_image_url && (
        <div className="project-banner">
          <img
            src={project.banner_image_url}
            alt={project.banner_image_alt ?? ""}
            className="project-banner-img"
          />
        </div>
      )}

      <div className="process-share-row">
        <ShareButton
          title={project.title}
          processId={project.id}
          shareText={`Check out this project: ${project.title}`}
        />
      </div>

      <div className="project-detail-header">
        <ProcessHeader
          type="civic.project"
          title={project.title}
          status={statusDisplay(project.status)}
          aside={
            editPolicy?.editable ? (
              <button
                type="button"
                className="project-edit-btn"
                onClick={handleStartEdit}
                disabled={editStarting}
                title="Change the description, sources, banner, or related processes. Every change is kept on the page."
              >
                {editStarting ? "Opening…" : "Edit project"}
              </button>
            ) : null
          }
        >
          <div className="project-detail-meta">
            <Creator
              name={project.creator_name}
              isAdmin={project.creator_is_admin}
              officialType={project.creator_official_type}
              officialTitle={project.creator_official_title}
              prefix="by"
            />
            <span>&middot;</span>
            <span>{new Date(project.created_at).toLocaleDateString()}</span>
          </div>
        </ProcessHeader>
      </div>

      <BriefPointer processId={project.id} />

      {showEdited && (
        <div className="project-edited-toast" role="status" aria-live="polite">
          {toastText}
        </div>
      )}

      {/* Sentiment */}
      {project.status === "active" && (
        <div className="project-sentiment">
          <button
            type="button"
            className={`sentiment-btn${project.user_sentiment === "support" ? " is-active-support" : ""}`}
            onClick={() => onSentimentClick("support")}
            disabled={!user || sentimentLoading}
          >
            Support {project.support_count > 0 && `(${project.support_count})`}
          </button>
          <button
            type="button"
            className={`sentiment-btn${project.user_sentiment === "oppose" ? " is-active-oppose" : ""}`}
            onClick={() => onSentimentClick("oppose")}
            disabled={!user || sentimentLoading}
          >
            Oppose {project.oppose_count > 0 && `(${project.oppose_count})`}
          </button>
          {!user && (
            <span className="sentiment-counts">Sign in to show your support</span>
          )}
        </div>
      )}

      {/* The share moment, directly under the button that was just pressed
          rather than beside the icons at the top of the page. */}
      {project.user_sentiment === "support" && (
        <ShareMoment
          processId={project.id}
          text="You're backing this — share it so more neighbors find it."
        />
      )}

      {/* Description — replaced by the diff while the history is open. */}
      {project.description && !historyOpen && (
        <RichText className="project-description" text={project.description} />
      )}

      {/* Visible edit history — renders nothing until the project is edited. */}
      <EditHistory processId={project.id} onOpenChange={setHistoryOpen} />

      {/* Sources — the shared renderer, same as conversations. It was the
          raw line as both href and text, so the href was not a URL at all
          and the browser resolved it relative to the hub (Adam, 2026-09-04:
          the links "open up a page on the Floyd Civic Hub and don't load
          anything"). */}
      <SourceLinks sources={project.sources} />

      {/* Updates timeline */}
      <div className="project-updates">
        <h2>Updates ({project.updates.length})</h2>

        {isCreator && project.status === "active" && (
          <div className="project-update-form">
            <MarkdownTextarea
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              placeholder="Share an update on your project..."
            />
            <button
              type="button"
              onClick={handlePostUpdate}
              disabled={!updateText.trim() || updatePosting}
            >
              {updatePosting ? "Posting..." : "Post update"}
            </button>
          </div>
        )}

        {project.updates.length === 0 ? (
          <p className="empty-state-inline">No updates yet.</p>
        ) : (
          project.updates.map((u) => (
            <div key={u.id} className="project-update-item">
              <RichText className="project-update-content" text={u.content} />
              <div className="project-update-time">
                {new Date(u.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Comments */}
      <div className="project-comments">
        <h2>Comments ({comments.length})</h2>

        {user && (
          <div className="project-comment-form">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
            />
            <button
              type="button"
              onClick={handlePostComment}
              disabled={!commentText.trim() || commentPosting}
            >
              {commentPosting ? "Posting..." : "Comment"}
            </button>
          </div>
        )}

        {comments.length === 0 ? (
          <p className="empty-state-inline">No comments yet.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="project-comment-item">
              <div className="project-comment-content">{c.content}</div>
              <div className="project-comment-meta">
                <Creator
                  name={c.creator_name}
                  isAdmin={c.creator_is_admin}
                  officialType={c.creator_official_type}
                  officialTitle={c.creator_official_title}
                />
                <span>
                  {new Date(c.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <RelatedProcesses
        processId={project.id}
        title={project.title}
        description={project.description}
      />

      {/* Terminal actions — creator/admin "Mark complete" and the admin-only
          archive — live at the very bottom, after the record and its links,
          so nobody reaches them by accident. */}
      <DetailActions>
        {canComplete && (
          <button
            type="button"
            className="project-complete-btn"
            onClick={handleComplete}
            disabled={completing}
          >
            {completing ? "Completing…" : "Mark complete"}
          </button>
        )}
        <AdminArchiveButton
          processId={project.id}
          itemLabel="project"
          onArchived={() => navigate("/projects")}
        />
      </DetailActions>
    </div>
  );
}
