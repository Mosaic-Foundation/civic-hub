import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import RichText from "../../components/RichText";
import AuthModal from "../../components/AuthModal";
import DraftShell from "../../components/DraftShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useAuth } from "../../context/AuthContext";
import { useDraftFlow, type BaseDraft } from "../../hooks/useDraftFlow";
import { draftApi, type ProposedLink } from "../../services/api";
import { reviewDestination, type DraftKindConfig, type DraftPageContext } from "./types";
// The drafting styles, in the order the four pages used to load them (the
// later sheets refine .confirm-duration and the edit-mode finality note).
import "../ProposeDraft.css";
import "../ProposeDraftVote.css";
import "../ProjectDraft.css";

/**
 * ONE creation flow, for every drafting kind (Audit 3, F1): the drafting form
 * IS the page. No path choice: AI writing help is a collapsed panel the user
 * can open (DraftShell), and everything here is fully usable without it. The
 * draft row is created lazily on the first real interaction. A kind supplies
 * its form and its wording (pages/draft/*Kind.tsx); the rest is here.
 */
export default function DraftPage<D extends BaseDraft & { assistant_helped: boolean; updated_at: string; links: ProposedLink[] }>({
  config,
}: {
  config: DraftKindConfig<D>;
}) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const api = useMemo(() => draftApi<D>(config.kind), [config.kind]);

  // Revision (from "Edit & resubmit"): reopen THIS draft and, on submit,
  // revise the review it came from instead of creating a new process.
  const [searchParams] = useSearchParams();
  const resumeDraftId = searchParams.get("draft");
  const ctx: DraftPageContext = {
    isAdmin,
    reviseReviewId: searchParams.get("review"),
    editProcessId: searchParams.get("edit"),
    searchParams,
  };

  const [kindState, setKindStateRaw] = useState<Record<string, unknown>>({});
  const setKindState = useCallback(
    (patch: Record<string, unknown>) => setKindStateRaw((s) => ({ ...s, ...patch })),
    [],
  );

  const toFlow = config.toFlow ?? ((d: D) => d);
  const toServer = config.toServer ?? ((p: Record<string, unknown>) => p);
  const flow = useDraftFlow<D>({
    processType: config.processType,
    createDraft: () => api.create(config.createBody).then(toFlow),
    updateDraft: (id, patch) => api.update(id, toServer(patch)).then(toFlow),
    resumeDraft: resumeDraftId ? () => api.get(resumeDraftId).then(toFlow) : undefined,
    applyFields: config.applyFields(kindState),
  });

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localLinks, setLocalLinks] = useState<ProposedLink[]>([]);
  // Titles for links already on the draft, so the list can render without a
  // lookup round-trip. Repopulated by the picker as the author chooses.
  const [linkTitles, setLinkTitles] = useState<Record<string, { title: string; type: string }>>({});

  const draft = flow.draft;
  const displayDraft: D = draft ?? { ...config.emptyDraft, ...(flow.pendingFields as Partial<D>) };

  const { queuePatch } = flow;
  const handleLinksChange = useCallback(
    (links: ProposedLink[]) => {
      setLocalLinks(links);
      // Links are not read by the Code of Conduct check, so the server leaves
      // a passed check standing.
      void queuePatch({ links });
    },
    [queuePatch],
  );

  async function confirmSubmit() {
    if (!draft || submitting) return;
    setSubmitting(true);
    flow.setError(null);
    try {
      const dest = config.submit
        ? await config.submit(api, draft, ctx)
        : reviewDestination(
            await api.submit(draft.id, ctx.reviseReviewId ? { review_id: ctx.reviseReviewId } : undefined),
            config.liveUrl,
          );
      if (dest) navigate(dest.to, dest.state === undefined ? undefined : { state: dest.state });
    } catch (err) {
      flow.setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  const shell = config.shell(ctx);
  const Form = config.Form;
  const { confirm } = config;
  const softCount = draft?.last_review_result?.filter((s) => s.severity === "soft").length ?? 0;

  return (
    <>
      {flow.showAuthModal && (
        <AuthModal onComplete={flow.handleAuthComplete} onDismiss={flow.closeAuthModal} />
      )}

      <DraftShell
        backTo={shell.backTo}
        backLabel={shell.backLabel}
        backAsButton={shell.backAsButton}
        title={shell.title}
        processType={config.processType}
        formVersion={draft?.updated_at ?? null}
        error={flow.error}
        reviewNotice={flow.reviewNotice}
        assistant={shell.noAssistant ? null : flow.shellAssistant}
        reviewSuggestions={draft?.last_review_result}
        onApplySuggestion={flow.handleApplySuggestion}
        canApplySuggestion={flow.canApplySuggestion}
      >
        {flow.resuming ? (
          <p className="form-hint" style={{ padding: "var(--space-lg)" }}>Loading your draft…</p>
        ) : (
          <Form
            draft={displayDraft}
            saved={draft}
            flow={flow}
            ctx={ctx}
            links={draft?.links ?? localLinks}
            onLinksChange={handleLinksChange}
            linkTitles={linkTitles}
            onLinkTitlesChange={setLinkTitles}
            onSubmit={() => setShowConfirm(true)}
            disabled={submitting}
            kindState={kindState}
            setKindState={setKindState}
          />
        )}
      </DraftShell>

      {showConfirm && draft && (
        <ConfirmDialog
          title={confirm.title(ctx)}
          confirmLabel={confirm.confirmLabel(ctx)}
          busy={submitting}
          onConfirm={confirmSubmit}
          onClose={() => setShowConfirm(false)}
        >
          <div className="confirm-preview">
            <h3 className="confirm-title">{draft.title}</h3>
            {draft.description && <RichText className="confirm-desc" text={draft.description} />}
            {confirm.previewExtra?.(draft, ctx)}
          </div>

          {confirm.afterPreview?.(draft, ctx)}

          <p className={`confirm-finality-warning${confirm.finalityEdit?.(ctx) ? " confirm-finality-warning--edit" : ""}`}>
            {confirm.finality(ctx)}
          </p>

          {draft.assistant_helped && (
            <p className="confirm-disclosure">
              This {confirm.noun} was drafted with AI assistant help. You are responsible for the content.{" "}
              {confirm.audience} will see a small "drafted with assistant help" note.
            </p>
          )}

          {softCount > 0 && (
            <p className="confirm-soft-note">
              {softCount} suggestion{softCount > 1 ? "s" : ""} not addressed (these are optional).
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
