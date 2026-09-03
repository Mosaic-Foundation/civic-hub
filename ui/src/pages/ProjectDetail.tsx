import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import Creator from "../components/Creator";
import RelatedProcesses from "../components/RelatedProcesses";
import { BriefPointer } from "../components/BriefPointer";
import "./ProjectDetail.css";
import AdminArchiveButton from "../components/AdminArchiveButton";
import { statusDisplay } from "../components/statusDisplay";
import ProcessHeader from "../components/ProcessHeader";

export default function ProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
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
    <div className="page">
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
          shareText={`Check out this project: ${project.title}`}
        />
      </div>

      <div className="project-detail-header">
        <ProcessHeader
          type="civic.project"
          title={project.title}
          status={statusDisplay(project.status)}
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
      </div>

      <BriefPointer processId={project.id} />

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

      {/* Description */}
      {project.description && (
        <div className="project-description">{project.description}</div>
      )}

      {/* Sources */}
      {project.sources.length > 0 && (
        <div className="project-sources">
          <h3>Sources</h3>
          <ul>
            {project.sources.map((url, i) => (
              <li key={i}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Updates timeline */}
      <div className="project-updates">
        <h2>Updates ({project.updates.length})</h2>

        {isCreator && project.status === "active" && (
          <div className="project-update-form">
            <textarea
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
              <div className="project-update-content">{u.content}</div>
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

      {/* Admin-only soft-remove. Renders nothing for everyone else. */}
      <AdminArchiveButton
        processId={project.id}
        itemLabel="project"
        onArchived={() => navigate("/projects")}
      />

      <RelatedProcesses
        processId={project.id}
        title={project.title}
        description={project.description}
      />
    </div>
  );
}
