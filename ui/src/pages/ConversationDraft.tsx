import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDraftFlow } from "../hooks/useDraftFlow";
import AuthModal from "../components/AuthModal";
import DraftShell from "../components/DraftShell";
import DeliberationDraftingForm from "../components/DeliberationDraftingForm";
import {
  createDeliberationDraft,
  updateDeliberationDraft,
  submitDeliberationDraft as apiSubmitDeliberationDraft,
  type DeliberationDraft,
} from "../services/api";
import "./ProposeDraft.css";

/**
 * Conversation creation on the ONE shared flow — same shell, same lazy
 * draft, same collapsed assistant (topic + framing only; the deliberation
 * handler declares its config through the registry). Residents submit for
 * review; admins are auto-approved and the conversation auto-starts. The
 * duration picker replaces the old deadline date — the deadline is
 * computed when the conversation starts.
 */

const DURATION_LABELS: Record<number, string> = {
  [14 * 24 * 60 * 60 * 1000]: "2 weeks",
  [30 * 24 * 60 * 60 * 1000]: "1 month",
  [42 * 24 * 60 * 60 * 1000]: "6 weeks",
  [60 * 24 * 60 * 60 * 1000]: "2 months",
  [90 * 24 * 60 * 60 * 1000]: "3 months",
};

const EMPTY_DRAFT: DeliberationDraft = {
  id: "",
  user_id: "",
  title: "",
  description: "",
  seed_statements: "",
  duration_ms: 42 * 24 * 60 * 60 * 1000,
  participation_threshold: null,
  conversation_history: [],
  last_review_result: null,
  draft_modified_since_review: false,
  assistant_helped: false,
  status: "drafting",
  created_at: "",
  updated_at: "",
};

export default function ConversationDraft() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const flow = useDraftFlow<DeliberationDraft>({
    processType: "civic.polis_deliberation",
    createDraft: () => createDeliberationDraft(),
    updateDraft: (id, patch) => updateDeliberationDraft(id, patch),
    applyFields: ["title", "description"],
  });

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const draft = flow.draft;
  const displayDraft: DeliberationDraft = draft ?? {
    ...EMPTY_DRAFT,
    ...(flow.pendingFields as Partial<DeliberationDraft>),
  };

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      void flow.queuePatch({ [field]: value });
    },
    [flow.queuePatch],
  );

  const handleDurationChange = useCallback(
    (ms: number) => {
      void flow.queuePatch({ duration_ms: ms });
    },
    [flow.queuePatch],
  );

  const handleThresholdChange = useCallback(
    (n: number | null) => {
      // Not a content change — the CoC check reads topic/framing only.
      void flow.queuePatch({ participation_threshold: n }, { skipModifiedFlag: true });
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
      const result = await apiSubmitDeliberationDraft(draft.id);
      if (result.auto_approved) {
        navigate("/deliberations");
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

  const durationLabel = draft
    ? DURATION_LABELS[draft.duration_ms] ??
      `${Math.round(draft.duration_ms / (24 * 60 * 60 * 1000))} days`
    : "";

  return (
    <>
      {flow.showAuthModal && (
        <AuthModal
          onComplete={flow.handleAuthComplete}
          onDismiss={flow.closeAuthModal}
        />
      )}

      <DraftShell
        backTo="/deliberations"
        backLabel="Conversations"
        title="Start a conversation"
        error={flow.error}
        reviewNotice={flow.reviewNotice}
        assistant={flow.shellAssistant}
        reviewSuggestions={draft?.last_review_result}
        onApplySuggestion={flow.handleApplySuggestion}
      >
        <DeliberationDraftingForm
          draft={displayDraft}
          onFieldChange={handleFieldChange}
          onDurationChange={handleDurationChange}
          onThresholdChange={handleThresholdChange}
          onReview={flow.handleReview}
          onSubmit={handleSubmit}
          disabled={submitting}
          reviewLoading={flow.reviewing}
          reviewFailed={flow.reviewFailed}
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
              Submit your conversation
            </h2>
            <div className="confirm-preview">
              <h3 className="confirm-title">{draft.title}</h3>
              {draft.description && (
                <p className="confirm-desc">{draft.description}</p>
              )}
              <p className="confirm-duration">
                Open for {durationLabel} once the conversation starts
                {draft.participation_threshold
                  ? `, or until ${draft.participation_threshold} people have participated`
                  : ""}.
              </p>
            </div>

            <p className="confirm-finality-warning">
              {isAdmin
                ? "Once submitted, your conversation goes live and participants can join right away."
                : "Your conversation will be submitted for review before going live. You'll be notified when an admin has reviewed it."}
            </p>

            {draft.assistant_helped && (
              <p className="confirm-disclosure">
                This conversation was drafted with AI assistant help. You are
                responsible for the content. Participants will see a small
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
                {submitting ? "Submitting..." : isAdmin ? "Create conversation" : "Submit for review"}
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
