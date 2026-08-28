import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDraftFlow } from "../hooks/useDraftFlow";
import AuthModal from "../components/AuthModal";
import DraftShell from "../components/DraftShell";
import ProjectDraftingForm from "../components/ProjectDraftingForm";
import {
  createProjectDraft,
  updateProjectDraft,
  submitProjectDraft as apiSubmitProjectDraft,
  type ProjectDraft as ProjectDraftType,
} from "../services/api";
import "./ProjectDraft.css";
import type { ProposedLink } from "../services/api";

/**
 * ONE creation flow — the drafting form IS the page. No path choice: AI
 * writing help is a collapsed panel the user can open (DraftShell), and
 * everything here is fully usable without it. The draft row is created
 * lazily on the first real interaction.
 */

const EMPTY_DRAFT: ProjectDraftType = {
  id: "",
  user_id: "",
  title: "",
  description: "",
  sources: "",
  banner_image_url: null,
  banner_image_alt: null,
  conversation_history: [],
  last_review_result: null,
  draft_modified_since_review: false,
  assistant_helped: false,
  status: "drafting",
  created_at: "",
  updated_at: "",
  links: [],
};

export default function ProjectDraft() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const flow = useDraftFlow<ProjectDraftType>({
    processType: "civic.project",
    createDraft: () => createProjectDraft(),
    updateDraft: (id, patch) => updateProjectDraft(id, patch),
    applyFields: ["title", "description", "sources"],
  });

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localLinks, setLocalLinks] = useState<ProposedLink[]>([]);
  // Titles for links already on the draft, so the list can render without a
  // lookup round-trip. Repopulated by the picker as the author chooses.
  const [linkTitles, setLinkTitles] = useState<
    Record<string, { title: string; type: string }>
  >({});

  const draft = flow.draft;
  const displayDraft: ProjectDraftType = draft ?? {
    ...EMPTY_DRAFT,
    ...(flow.pendingFields as Partial<ProjectDraftType>),
  };

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      void flow.queuePatch({ [field]: value });
    },
    [flow.queuePatch],
  );

  const handleImageChange = useCallback(
    (next: { image_url: string | null; image_alt: string | null }) => {
      void flow.queuePatch(
        {
          banner_image_url: next.image_url,
          banner_image_alt: next.image_alt,
        },
        { skipModifiedFlag: true },
      );
    },
    [flow.queuePatch],
  );

  const handleLinksChange = useCallback(
    (links: ProposedLink[]) => {
      setLocalLinks(links);
      // skip_modified_flag: adding a link is not a content change, so it must
      // not invalidate a Code of Conduct check the author already passed.
      void flow.queuePatch({ links }, { skipModifiedFlag: true });
    },
    [flow.queuePatch],
  );

  function handleSubmit() {
    setShowConfirm(true);
  }

  async function confirmSubmit() {
    if (!draft || submitting) return;
    setSubmitting(true);
    flow.setError(null);
    try {
      const result = await apiSubmitProjectDraft(draft.id);
      if (result.auto_approved) {
        navigate(`/project/${result.process_id}`);
      } else {
        navigate(`/my-submissions/${result.review_id}`, { state: { submitted: true } });
      }
    } catch (err) {
      flow.setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  return (
    <>
      {flow.showAuthModal && (
        <AuthModal
          onComplete={flow.handleAuthComplete}
          onDismiss={flow.closeAuthModal}
        />
      )}

      <DraftShell
        backTo="/projects"
        backLabel="Projects"
        title="Start a project"
        error={flow.error}
        reviewNotice={flow.reviewNotice}
        assistant={flow.shellAssistant}
        reviewSuggestions={draft?.last_review_result}
        onApplySuggestion={flow.handleApplySuggestion}
      >
        <ProjectDraftingForm
          draft={displayDraft}
          links={draft?.links ?? localLinks}
          onLinksChange={handleLinksChange}
          linkTitles={linkTitles}
          onLinkTitlesChange={setLinkTitles}
          onFieldChange={handleFieldChange}
          onImageChange={handleImageChange}
          onReview={flow.handleReview}
          onSubmit={handleSubmit}
          disabled={submitting}
          reviewLoading={flow.reviewing}
          fieldGuidance={flow.config?.field_guidance}
        />
      </DraftShell>

      {/* Submit confirmation modal */}
      {showConfirm && draft && (
        <div className="intro-overlay" onClick={() => setShowConfirm(false)}>
          <div
            className="intro-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="intro-close"
              onClick={() => setShowConfirm(false)}
            >
              &times;
            </button>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--font-size-xl)", marginBottom: "var(--space-md)" }}>
              Submit your project
            </h2>
            <div className="confirm-preview">
              <h3 className="confirm-title">{draft.title}</h3>
              {draft.description && (
                <p className="confirm-desc">{draft.description}</p>
              )}
            </div>

            <p className="confirm-finality-warning">
              {isAdmin
                ? "Once submitted, your project cannot be edited. Please make sure everything looks the way you want it before submitting."
                : "Your project will be submitted for review before going live. You'll be notified when an admin has reviewed it."}
            </p>

            {draft.assistant_helped && (
              <p className="confirm-disclosure">
                This project was drafted with AI assistant help. You are
                responsible for the content. Visitors will see a small
                "drafted with assistant help" note.
              </p>
            )}

            {draft.last_review_result &&
              draft.last_review_result.filter((s) => s.severity === "soft")
                .length > 0 && (
                <p className="confirm-soft-note">
                  {
                    draft.last_review_result.filter(
                      (s) => s.severity === "soft",
                    ).length
                  }{" "}
                  suggestion
                  {draft.last_review_result.filter(
                    (s) => s.severity === "soft",
                  ).length > 1
                    ? "s"
                    : ""}{" "}
                  not addressed (these are optional).
                </p>
              )}

            <div className="confirm-actions">
              <button
                type="button"
                className="draft-submit-btn"
                onClick={confirmSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting..." : isAdmin ? "Submit project" : "Submit for review"}
              </button>
              <button
                type="button"
                className="draft-dispute-btn"
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
              >
                Go back to draft
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
