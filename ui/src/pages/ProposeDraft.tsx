import { useState, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRequireAuth } from "../hooks/useRequireAuth";
import AuthModal from "../components/AuthModal";
import AssistantPanel, { type ChatMessage } from "../components/AssistantPanel";
import DraftingForm from "../components/DraftingForm";
import {
  createDraft,
  updateDraft,
  sendAssistantMessage,
  reviewDraft,
  submitDraft as apiSubmitDraft,
  type ProposalDraft,
  type DraftSuggestion,
} from "../services/api";
import "./ProposeDraft.css";

/**
 * Slice B — Proposal drafting page. Simplified to 2 steps:
 *   path     — brainstorm or write-my-own
 *   drafting — two-pane form + AI assistant
 *
 * The old 3-step flow (category → path → drafting) is gone.
 * The idea/concern sub-type lives inside the DraftingForm as a
 * lightweight toggle — no separate category selection step.
 */
type Step = "path" | "drafting";

function friendlyError(msg: string): string {
  if (msg.includes("rate_limit") || msg.includes("429"))
    return "The assistant is getting too many requests right now. Wait a moment and try again.";
  if (msg.includes("ANTHROPIC_API_KEY"))
    return "The assistant isn't configured yet. Please contact the hub admin.";
  if (msg.includes("timeout") || msg.includes("aborted"))
    return "The assistant took too long to respond. Try again with a shorter message.";
  return "Something went wrong with the assistant. Try again in a moment.";
}

const DURATION_LABELS: Record<number, string> = {
  [30 * 24 * 60 * 60 * 1000]: "1 month",
  [90 * 24 * 60 * 60 * 1000]: "3 months",
  [180 * 24 * 60 * 60 * 1000]: "6 months",
};

export default function ProposeDraft() {
  const navigate = useNavigate();
  const { canParticipate, isAdmin } = useAuth();
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();

  const [step, setStep] = useState<Step>("path");
  const [draft, setDraft] = useState<ProposalDraft | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMobileAssistant, setShowMobileAssistant] = useState(false);
  const [phase, setPhase] = useState<"brainstorm" | "free_form" | "review">("brainstorm");
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const isMobile = useIsMobile();

  async function startDraft(path: "brainstorm" | "write") {
    requireAuth(async () => {
      setLoading(true);
      setError(null);
      try {
        // Create draft with "idea" as the default sub-type. The user
        // can switch to "concern" inside the form.
        const d = await createDraft("idea");
        setDraft(d);
        setStep("drafting");

        if (path === "brainstorm") {
          setPhase("brainstorm");
          const greeting =
            "Want to think through this together first, or do you want to write your own draft and I'll review it?";
          setMessages([
            { role: "assistant", content: greeting },
          ]);

          const result = await sendAssistantMessage(
            d.id,
            "brainstorm",
            "I want to propose something for the community to consider.",
          );
          setDraft(result.draft);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: result.response.message,
              suggestions:
                result.response.suggestions.length > 0
                  ? result.response.suggestions
                  : undefined,
            },
          ]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create draft");
      } finally {
        setLoading(false);
      }
    });
  }

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!draft) return;
      setLoading(true);
      setError(null);
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      try {
        const result = await sendAssistantMessage(draft.id, phase, text);
        setDraft(result.draft);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.response.message,
            suggestions:
              result.response.suggestions.length > 0
                ? result.response.suggestions
                : undefined,
          },
        ]);

        if (result.response.draft_proposal) {
          setDraft(result.draft);
          setPhase("free_form");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: friendlyError(msg) },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [draft, phase],
  );

  const handleReview = useCallback(async () => {
    if (!draft) return;
    setLoading(true);
    setReviewing(true);
    setError(null);
    setReviewFailed(false);
    setReviewNotice(null);
    try {
      const result = await reviewDraft(draft.id);
      setDraft(result.draft);
      setReviewNotice(result.review_unavailable ? result.response.message : null);
      setMessages((prev) => {
        const cleaned = prev.map((msg) =>
          msg.suggestions ? { ...msg, role: msg.role, content: msg.content } : msg,
        );
        return [
          ...cleaned,
          {
            role: "assistant" as const,
            content: result.response.message,
            suggestions:
              result.response.suggestions.length > 0
                ? result.response.suggestions
                : undefined,
          },
        ];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setReviewFailed(true);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: friendlyError(msg) },
      ]);
    } finally {
      setLoading(false);
      setReviewing(false);
    }
  }, [draft]);

  const handleFieldChange = useCallback(
    async (field: string, value: string) => {
      if (!draft) return;
      try {
        const updated = await updateDraft(draft.id, { [field]: value });
        setDraft(updated);
      } catch {
        // silent — field saves are best-effort
      }
    },
    [draft],
  );

  const handleDurationChange = useCallback(
    async (ms: number) => {
      if (!draft) return;
      try {
        const updated = await updateDraft(draft.id, { proposal_duration_ms: ms });
        setDraft(updated);
      } catch {
        // silent
      }
    },
    [draft],
  );

  const handleApplySuggestion = useCallback(
    async (suggestion: DraftSuggestion) => {
      if (!draft || !suggestion.field || !suggestion.suggested_revision) return;
      if (suggestion.field === "considerations") return;

      const field = suggestion.field as keyof Pick<ProposalDraft, "title" | "description" | "sources">;
      const current = String(draft[field] ?? "");
      let newValue: string;

      if (suggestion.quoted_text && current.includes(suggestion.quoted_text)) {
        newValue = current.replace(suggestion.quoted_text, suggestion.suggested_revision);
      } else if (current.trim()) {
        newValue = current.trim() + "\n\n" + suggestion.suggested_revision;
      } else {
        newValue = suggestion.suggested_revision;
      }

      try {
        const updated = await updateDraft(draft.id, {
          [suggestion.field]: newValue,
          skip_modified_flag: true,
        });
        setDraft(updated);
      } catch {
        // silent
      }

      const inputId = `draft-${suggestion.field}`;
      const el = document.getElementById(inputId) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (el) el.value = newValue;
    },
    [draft],
  );

  async function handleSubmit() {
    setShowConfirm(true);
  }

  async function confirmSubmit() {
    if (!draft || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiSubmitDraft(draft.id);
      if (result.auto_approved) {
        navigate(`/proposal/${result.process_id}`);
      } else {
        navigate(`/my-submissions/${result.review_id}`, { state: { submitted: true } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  // --- Render ---

  if (step === "path") {
    return (
      <div className="page detail-page">
        {showAuthModal && (
          <AuthModal
            onComplete={handleAuthComplete}
            onDismiss={closeAuthModal}
          />
        )}
        <Link to="/propose" className="back-link">
          &larr; Proposals
        </Link>
        <h1>Propose something</h1>
        <p className="propose-description">
          Share an <span className="keyword-idea">idea</span> or raise a{" "}
          <span className="keyword-concern">concern</span> for the community
          to consider. Your proposal goes live after a quick review.
        </p>

        {!canParticipate && (
          <p className="auth-prompt-inline">
            You'll need to create an account before submitting.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}
        {reviewNotice && <p className="form-hint">{reviewNotice}</p>}

        <div className="path-choice">
          <button
            type="button"
            className="path-card"
            onClick={() => startDraft("brainstorm")}
            disabled={loading}
          >
            <span className="path-card-label">Draft with the assistant</span>
            <span className="path-card-desc">
              Optional writing help: the assistant will ask a few questions
              to help shape your proposal, then offer to generate a starting
              draft.
            </span>
          </button>

          <button
            type="button"
            className="path-card"
            onClick={() => startDraft("write")}
            disabled={loading}
          >
            <span className="path-card-label">I'll write my own</span>
            <span className="path-card-desc">
              Jump straight to the form — no AI writing help unless you ask
              for it.
            </span>
          </button>
        </div>

        <p className="path-choice-note">
          Whichever you choose, every draft gets a quick automated Code of
          Conduct check before it goes to the hub admin for review. The check
          isn't writing help — it just flags anything that would block
          approval.
        </p>
      </div>
    );
  }

  // step === "drafting"
  if (!draft) return null;

  const assistantPanel = (
    <AssistantPanel
      messages={messages}
      onSendMessage={handleSendMessage}
      onApplySuggestion={handleApplySuggestion}
      loading={loading}
      phase={phase}
      loadingLabel={reviewing ? "Running Code of Conduct check" : "Thinking"}
    />
  );

  return (
    <div className="propose-draft-page">
      {showAuthModal && (
        <AuthModal
          onComplete={handleAuthComplete}
          onDismiss={closeAuthModal}
        />
      )}

      {/* Desktop two-pane */}
      {!isMobile && (
        <div className="propose-draft-layout">
          <div className="propose-draft-assistant">{assistantPanel}</div>
          <div className="propose-draft-form">
            <div className="propose-draft-form-header">
              <Link to="/propose" className="back-link">
                &larr; Proposals
              </Link>
              <h1 className="propose-draft-title">Propose something</h1>
            </div>
            {error && <p className="form-error" style={{ padding: "0 var(--space-lg)" }}>{error}</p>}
            <DraftingForm
              draft={draft}
              onFieldChange={handleFieldChange}
              onDurationChange={handleDurationChange}
              onReview={handleReview}
              onSubmit={handleSubmit}
              disabled={submitting}
              reviewLoading={loading}
              reviewFailed={reviewFailed}
            />
          </div>
        </div>
      )}

      {/* Mobile single-pane */}
      {isMobile && (
        <>
          <div className="propose-draft-mobile">
            <div className="page detail-page">
              <Link to="/propose" className="back-link">
                &larr; Proposals
              </Link>
              <h1>Propose something</h1>
              {error && <p className="form-error">{error}</p>}
        {reviewNotice && <p className="form-hint">{reviewNotice}</p>}
              <DraftingForm
                draft={draft}
                onFieldChange={handleFieldChange}
                onDurationChange={handleDurationChange}
                onReview={handleReview}
                onSubmit={handleSubmit}
                disabled={submitting}
                reviewLoading={loading}
              />
            </div>
          </div>

          <button
            type="button"
            className="assistant-fab"
            onClick={() => setShowMobileAssistant(true)}
            aria-label="Open drafting assistant"
          >
            ?
          </button>

          {showMobileAssistant && (
            <div className="assistant-overlay">
              <div className="assistant-header" style={{ display: "flex", justifyContent: "space-between" }}>
                <h3 className="assistant-title">Drafting assistant</h3>
                <button
                  type="button"
                  className="assistant-close-btn"
                  onClick={() => setShowMobileAssistant(false)}
                  aria-label="Close assistant"
                >
                  &times;
                </button>
              </div>
              {assistantPanel}
            </div>
          )}
        </>
      )}

      {/* Submit confirmation modal */}
      {showConfirm && (
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
              Submit your proposal
            </h2>
            <div className="confirm-preview">
              <h3 className="confirm-title">{draft.title}</h3>
              {draft.description && (
                <p className="confirm-desc">{draft.description}</p>
              )}
            </div>

            <p className="confirm-duration">
              This proposal will stay open for{" "}
              {DURATION_LABELS[draft.proposal_duration_ms] ??
                (Number.isFinite(draft.proposal_duration_ms) &&
                draft.proposal_duration_ms > 0
                  ? `${Math.round(draft.proposal_duration_ms / (24 * 60 * 60 * 1000))} days`
                  : "90 days")}.
            </p>

            <p className="confirm-finality-warning">
              {isAdmin
                ? "Once submitted, your proposal cannot be edited. Please make sure everything looks the way you want it before submitting."
                : "Your proposal will be submitted for review before going live. You'll be notified when an admin has reviewed it."}
            </p>

            {draft.assistant_helped && (
              <p className="confirm-disclosure">
                This proposal was drafted with AI assistant help. You are
                responsible for the content. Readers will see a small
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
                {submitting ? "Submitting..." : isAdmin ? "Submit proposal" : "Submit for review"}
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
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 769 : false,
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 769);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isMobile;
}
