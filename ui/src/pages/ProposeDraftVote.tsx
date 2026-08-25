import { useState, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRequireAuth } from "../hooks/useRequireAuth";
import AuthModal from "../components/AuthModal";
import AssistantPanel, { type ChatMessage } from "../components/AssistantPanel";
import VoteDraftingForm from "../components/VoteDraftingForm";
import {
  createVoteDraft,
  updateVoteDraft,
  sendVoteAssistantMessage,
  reviewVoteDraft,
  submitVoteDraft as apiSubmitVoteDraft,
  type VoteDraft,
  type DraftSuggestion,
} from "../services/api";
import "./ProposeDraftVote.css";
import type { ProposedLink } from "../services/api";

type Step = "path" | "drafting";

const DURATION_LABELS: Record<number, string> = {
  [14 * 24 * 60 * 60 * 1000]: "2 weeks",
  [30 * 24 * 60 * 60 * 1000]: "1 month",
  [60 * 24 * 60 * 60 * 1000]: "2 months",
  [90 * 24 * 60 * 60 * 1000]: "3 months",
};

function friendlyError(msg: string): string {
  if (msg.includes("rate_limit") || msg.includes("429"))
    return "The assistant is getting too many requests right now. Wait a moment and try again.";
  if (msg.includes("ANTHROPIC_API_KEY"))
    return "The assistant isn't configured yet. Please contact the hub admin.";
  if (msg.includes("timeout") || msg.includes("aborted"))
    return "The assistant took too long to respond. Try again with a shorter message.";
  return "Something went wrong with the assistant. Try again in a moment.";
}

export default function ProposeDraftVote() {
  const navigate = useNavigate();
  const { canParticipate, isAdmin } = useAuth();
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();

  const [step, setStep] = useState<Step>("path");
  const [draft, setDraft] = useState<VoteDraft | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMobileAssistant, setShowMobileAssistant] = useState(false);
  const [phase, setPhase] = useState<"brainstorm" | "free_form" | "review">("brainstorm");
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Titles for links already on the draft, so the list can render without a
  // lookup round-trip. Repopulated by the picker as the author chooses.
  const [linkTitles, setLinkTitles] = useState<
    Record<string, { title: string; type: string }>
  >({});
  const [reviewFailed, setReviewFailed] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const isMobile = useIsMobile();

  async function startDraft(path: "brainstorm" | "write") {
    requireAuth(async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await createVoteDraft();
        setDraft(d);
        setStep("drafting");

        if (path === "brainstorm") {
          setPhase("brainstorm");
          const greeting =
            "Want to think through this together first, or do you want to write your own draft and I'll review it?";
          setMessages([
            { role: "assistant", content: greeting },
          ]);

          const result = await sendVoteAssistantMessage(
            d.id,
            "brainstorm",
            "I want to suggest a vote for the community.",
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
        const result = await sendVoteAssistantMessage(draft.id, phase, text);
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


  const handleLinksChange = useCallback(
    async (links: ProposedLink[]) => {
      if (!draft) return;
      // Persist immediately. Links are part of the draft, so they must
      // survive a refresh the same way the prose does.
      // skip_modified_flag: adding a link is not a content change, so it must
      // not invalidate a Code of Conduct check the author already passed.
      try {
        const updated = await updateVoteDraft(draft.id, { links, skip_modified_flag: true });
        setDraft(updated);
      } catch {
        // Non-fatal: the picked link is still in the form's state and will be
        // sent with the submission.
      }
    },
    [draft],
  );

  const handleReview = useCallback(async () => {
    if (!draft) return;
    setLoading(true);
    setReviewing(true);
    setError(null);
    setReviewFailed(false);
    setReviewNotice(null);
    try {
      const result = await reviewVoteDraft(draft.id);
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
        const updated = await updateVoteDraft(draft.id, { [field]: value });
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
        const updated = await updateVoteDraft(draft.id, { voting_duration_ms: ms });
        setDraft(updated);
      } catch {
        // silent
      }
    },
    [draft],
  );

  const handleMethodChange = useCallback(
    async (method: string, options: string[] | null) => {
      if (!draft) return;
      try {
        const updated = await updateVoteDraft(draft.id, { method, custom_options: options });
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

      const field = suggestion.field as keyof Pick<VoteDraft, "title" | "description" | "sources">;
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
        const updated = await updateVoteDraft(draft.id, {
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
      const result = await apiSubmitVoteDraft(draft.id);
      if (result.auto_approved) {
        navigate(`/process/${result.process_id}`);
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
        <Link to="/votes" className="back-link">
          &larr; Votes
        </Link>
        <h1>Suggest a vote</h1>
        <p className="propose-description">
          Submit a question for your neighbors to weigh in on. Once submitted,
          your vote goes live and the community can start voting right away.
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
              to help shape your vote, then offer to generate a starting
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

  const durationLabel = DURATION_LABELS[draft.voting_duration_ms] ?? `${Math.round(draft.voting_duration_ms / (24 * 60 * 60 * 1000))} days`;

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
              <Link to="/votes" className="back-link">
                &larr; Votes
              </Link>
              <h1 className="propose-draft-title">Suggest a vote</h1>
            </div>
            {error && <p className="form-error" style={{ padding: "0 var(--space-lg)" }}>{error}</p>}
            <VoteDraftingForm
              draft={draft}
              links={draft.links ?? []}
              onLinksChange={handleLinksChange}
              linkTitles={linkTitles}
              onLinkTitlesChange={setLinkTitles}
              onFieldChange={handleFieldChange}
              onDurationChange={handleDurationChange}
              onMethodChange={handleMethodChange}
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
              <Link to="/votes" className="back-link">
                &larr; Votes
              </Link>
              <h1>Suggest a vote</h1>
              {error && <p className="form-error">{error}</p>}
        {reviewNotice && <p className="form-hint">{reviewNotice}</p>}
              <VoteDraftingForm
                draft={draft}
                links={draft.links ?? []}
                onLinksChange={handleLinksChange}
                linkTitles={linkTitles}
                onLinkTitlesChange={setLinkTitles}
                onFieldChange={handleFieldChange}
                onDurationChange={handleDurationChange}
                onMethodChange={handleMethodChange}
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
              Submit your vote
            </h2>
            <div className="confirm-preview">
              <h3 className="confirm-title">{draft.title}</h3>
              {draft.description && (
                <p className="confirm-desc">{draft.description}</p>
              )}
              {draft.method === "approval" && draft.custom_options && (
                <div className="confirm-options">
                  <p className="confirm-options-label">Options:</p>
                  <ul className="confirm-options-list">
                    {draft.custom_options.map((opt, i) => (
                      <li key={i}>{opt}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="confirm-duration">
                Voting method: {draft.method === "approval" ? "Approval" : "Yes / No / Unsure"}.
                Voting will stay open for {durationLabel}.
              </p>
            </div>

            <p className="confirm-finality-warning">
              {isAdmin
                ? "Once submitted, your vote cannot be edited. Please make sure everything looks the way you want it before submitting."
                : "Your vote will be submitted for review before going live. You'll be notified when an admin has reviewed it."}
            </p>

            {draft.assistant_helped && (
              <p className="confirm-disclosure">
                This vote was drafted with AI assistant help. You are
                responsible for the content. Voters will see a small
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
                {submitting ? "Submitting..." : isAdmin ? "Submit vote" : "Submit for review"}
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
