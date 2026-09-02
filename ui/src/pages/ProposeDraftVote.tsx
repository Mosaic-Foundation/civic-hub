import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDraftFlow } from "../hooks/useDraftFlow";
import AuthModal from "../components/AuthModal";
import DraftShell from "../components/DraftShell";
import VoteDraftingForm from "../components/VoteDraftingForm";
import {
  createVoteDraft,
  updateVoteDraft,
  submitVoteDraft as apiSubmitVoteDraft,
  getVoteDraft,
  type VoteDraft,
} from "../services/api";
import "./ProposeDraftVote.css";
import type { ProposedLink } from "../services/api";

/**
 * ONE creation flow — the drafting form IS the page. No path choice: AI
 * writing help is a collapsed panel the user can open (DraftShell), and
 * everything here is fully usable without it. The draft row is created
 * lazily on the first real interaction.
 */

const DURATION_LABELS: Record<number, string> = {
  [14 * 24 * 60 * 60 * 1000]: "2 weeks",
  [30 * 24 * 60 * 60 * 1000]: "1 month",
  [42 * 24 * 60 * 60 * 1000]: "6 weeks",
  [60 * 24 * 60 * 60 * 1000]: "2 months",
  [90 * 24 * 60 * 60 * 1000]: "3 months",
};

const EMPTY_DRAFT: VoteDraft = {
  id: "",
  user_id: "",
  title: "",
  description: "",
  sources: "",
  voting_duration_ms: 42 * 24 * 60 * 60 * 1000,
  method: "yes_no_unsure",
  custom_options: null,
  conversation_history: [],
  last_review_result: null,
  draft_modified_since_review: false,
  assistant_helped: false,
  status: "drafting",
  created_at: "",
  updated_at: "",
  links: [],
};

export default function ProposeDraftVote() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // Revision (from "Edit & resubmit"): reopen THIS draft and, on submit,
  // revise the review it came from instead of creating a new process.
  const [searchParams] = useSearchParams();
  const resumeDraftId = searchParams.get("draft");
  const reviseReviewId = searchParams.get("review");

  const flow = useDraftFlow<VoteDraft>({
    processType: "civic.vote",
    createDraft: () => createVoteDraft(),
    updateDraft: (id, patch) => updateVoteDraft(id, patch),
    resumeDraft: resumeDraftId ? () => getVoteDraft(resumeDraftId) : undefined,
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
  const displayDraft: VoteDraft = draft ?? {
    ...EMPTY_DRAFT,
    ...(flow.pendingFields as Partial<VoteDraft>),
  };

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      void flow.queuePatch({ [field]: value });
    },
    [flow.queuePatch],
  );

  const handleDurationChange = useCallback(
    (ms: number) => {
      void flow.queuePatch({ voting_duration_ms: ms });
    },
    [flow.queuePatch],
  );

  const handleMethodChange = useCallback(
    (method: string, options: string[] | null) => {
      void flow.queuePatch({ method, custom_options: options });
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
      const result = await apiSubmitVoteDraft(draft.id, reviseReviewId ? { review_id: reviseReviewId } : undefined);
      if (result.auto_approved) {
        navigate(`/process/${result.process_id}`);
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
    ? DURATION_LABELS[draft.voting_duration_ms] ??
      `${Math.round(draft.voting_duration_ms / (24 * 60 * 60 * 1000))} days`
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
        backTo="/votes"
        backLabel="Votes"
        title={reviseReviewId ? "Revise your vote" : "Suggest a vote"}
        processType="civic.vote"
        formVersion={draft?.updated_at ?? null}
        error={flow.error}
        reviewNotice={flow.reviewNotice}
        assistant={flow.shellAssistant}
        reviewSuggestions={draft?.last_review_result}
        onApplySuggestion={flow.handleApplySuggestion}
        canApplySuggestion={flow.canApplySuggestion}
      >
        {flow.resuming ? (
          <p className="form-hint" style={{ padding: "var(--space-lg)" }}>Loading your draft…</p>
        ) : (
        <VoteDraftingForm
          draft={displayDraft}
          links={draft?.links ?? localLinks}
          onLinksChange={handleLinksChange}
          linkTitles={linkTitles}
          onLinkTitlesChange={setLinkTitles}
          onFieldChange={handleFieldChange}
          onDurationChange={handleDurationChange}
          onMethodChange={handleMethodChange}
          onReview={flow.handleReview}
          onSubmit={handleSubmit}
          disabled={submitting}
          reviewLoading={flow.reviewing}
          reviewFailed={flow.reviewFailed}
          fieldGuidance={flow.config?.field_guidance}
        />
        )}
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
    </>
  );
}
