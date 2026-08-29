import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDraftFlow } from "../hooks/useDraftFlow";
import AuthModal from "../components/AuthModal";
import DraftShell from "../components/DraftShell";
import DraftingForm from "../components/DraftingForm";
import {
  createDraft,
  updateDraft,
  submitDraft as apiSubmitDraft,
  type ProposalDraft,
} from "../services/api";
import "./ProposeDraft.css";
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
  // Retired option — still labels pre-2026-08-28 drafts that carry it.
  [180 * 24 * 60 * 60 * 1000]: "6 months",
};

const EMPTY_DRAFT: ProposalDraft = {
  id: "",
  user_id: "",
  category: "idea",
  title: "",
  description: "",
  sources: "",
  considerations: "",
  proposal_duration_ms: 42 * 24 * 60 * 60 * 1000,
  conversation_history: [],
  last_review_result: null,
  draft_modified_since_review: false,
  steward_approved: null,
  assistant_helped: false,
  status: "drafting",
  created_at: "",
  updated_at: "",
  links: [],
};

export default function ProposeDraft() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const flow = useDraftFlow<ProposalDraft>({
    processType: "civic.proposal",
    createDraft: () => createDraft("idea"),
    updateDraft: (id, patch) => updateDraft(id, patch),
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
  const displayDraft: ProposalDraft = draft ?? {
    ...EMPTY_DRAFT,
    ...(flow.pendingFields as Partial<ProposalDraft>),
  };

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      void flow.queuePatch({ [field]: value });
    },
    [flow.queuePatch],
  );

  const handleDurationChange = useCallback(
    (ms: number) => {
      void flow.queuePatch({ proposal_duration_ms: ms });
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
      const result = await apiSubmitDraft(draft.id);
      if (result.auto_approved) {
        navigate(`/proposal/${result.process_id}`);
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
        backTo="/propose"
        backLabel="Proposals"
        title="Propose something"
        error={flow.error}
        reviewNotice={flow.reviewNotice}
        assistant={flow.shellAssistant}
        reviewSuggestions={draft?.last_review_result}
        onApplySuggestion={flow.handleApplySuggestion}
        canApplySuggestion={flow.canApplySuggestion}
      >
        <DraftingForm
          draft={displayDraft}
          links={draft?.links ?? localLinks}
          onLinksChange={handleLinksChange}
          linkTitles={linkTitles}
          onLinkTitlesChange={setLinkTitles}
          onFieldChange={handleFieldChange}
          onDurationChange={handleDurationChange}
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
    </>
  );
}
