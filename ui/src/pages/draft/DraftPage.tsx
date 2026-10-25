import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import RichText from "../../components/RichText";
import AuthModal from "../../components/AuthModal";
import DraftShell from "../../components/DraftShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import { CocFindingsContext, hardFindings } from "../../components/cocFindingsState";
import { ApiError } from "../../utils/httpError";
import { useAuth } from "../../context/authState";
import { useHub } from "../../config/hub";
import { useDraftFlow, type BaseDraft } from "../../hooks/useDraftFlow";
import { draftApi, type ProposedLink } from "../../services/api";
import { reviewDestination, type DraftKindConfig, type DraftPageContext } from "./types";
// The drafting styles, in the order the four pages used to load them (the
// later sheets refine .confirm-duration and the edit-mode finality note).
import "../ProposeDraft.css";
import "../ProposeDraftVote.css";
import "../ProjectDraft.css";

/** The list of what the check flagged, which a flagged Submit moves focus to. */
const FLAGGED_PANEL_ID = "coc-flagged";

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
  const hub = useHub();
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
    hub,
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

  /**
   * Submit: everything typed is saved first, then the preview opens. Its
   * Submit runs the Code of Conduct check and submits, in one request
   * (Submit and Save, 2026-10-12).
   */
  function openConfirm() {
    flow.requireAuth(() => {
      flow.setError(null);
      flow
        .settle()
        .then(() => setShowConfirm(true))
        .catch((err) => flow.setError(err instanceof Error ? err.message : "Your draft couldn't be saved. Try again."));
    });
  }

  async function confirmSubmit() {
    if (!draft || submitting) return;
    setSubmitting(true);
    flow.setError(null);
    try {
      const saved = await flow.settle();
      const dest = config.submit
        ? await config.submit(api, saved, ctx)
        : reviewDestination(
            await api.submit(saved.id, ctx.reviseReviewId ? { review_id: ctx.reviseReviewId } : undefined),
            config.liveUrl,
          );
      if (dest) navigate(dest.to, dest.state === undefined ? undefined : { state: dest.state });
    } catch (err) {
      if (err instanceof ApiError && err.code === "code_of_conduct_flagged") {
        // Nothing was submitted and the draft is kept. Show what to fix:
        // next to each field, and in the list above the form.
        setShowConfirm(false);
        await api
          .get(draft.id)
          .then((d) => flow.replaceDraft(toFlow(d)))
          .catch(() => {});
        requestAnimationFrame(() => {
          const panel = document.getElementById(FLAGGED_PANEL_ID);
          panel?.scrollIntoView({ behavior: "smooth", block: "start" });
          panel?.focus({ preventScroll: true });
        });
      } else {
        flow.setError(err instanceof Error ? err.message : "Submit failed");
      }
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  // "Think this is wrong? Tell the admins": the flagged text goes to the
  // review queue as it is, marked as flagged, with an optional note.
  const [telling, setTelling] = useState<"closed" | "open" | "sending">("closed");
  const [tellNote, setTellNote] = useState("");
  const [tellError, setTellError] = useState<string | null>(null);

  async function sendToAdmins() {
    if (!draft || telling === "sending") return;
    setTelling("sending");
    setTellError(null);
    try {
      const saved = await flow.settle();
      const result = await api.submit(saved.id, {
        tell_admins: true,
        ...(tellNote.trim() ? { note: tellNote.trim() } : {}),
        ...(ctx.reviseReviewId ? { review_id: ctx.reviseReviewId } : {}),
      });
      const dest = reviewDestination(result, config.liveUrl);
      navigate(dest.to, dest.state === undefined ? undefined : { state: dest.state });
    } catch (err) {
      setTellError(err instanceof Error ? err.message : "It couldn't be sent. Try again.");
      setTelling("open");
    }
  }

  const findings = hardFindings(draft?.last_review_result);

  // A drafting page is a focused screen at phone width: the hub header and
  // the section tabs give way to one slim row (DraftShell), so a phone with
  // the keyboard open still shows the form. The CSS keys off this class.
  useEffect(() => {
    document.documentElement.classList.add("drafting-focus");
    return () => document.documentElement.classList.remove("drafting-focus");
  }, []);

  // "New proposal", "Revise your vote"…: the kind's own noun, no place names.
  const { noun } = config.confirm;
  const phoneTitle = ctx.editProcessId ? `Edit ${noun}` : ctx.reviseReviewId ? `Revise ${noun}` : `New ${noun}`;
  const saveNote =
    flow.saveState === "saving"
      ? "Saving…"
      : flow.saveState === "saved"
        ? "Draft saved"
        : flow.saveState === "failed"
          ? "Not saved"
          : null;
  // Typing a signed-out visitor did before signing in lives only here, and a
  // save in flight or failed hasn't reached the server.
  const hasUnsaved = () =>
    flow.saveState === "saving" || flow.saveState === "failed" || (!draft && Object.keys(flow.pendingFields).length > 0);

  const shell = config.shell(ctx);
  const Form = config.Form;
  const { confirm } = config;

  return (
    <>
      {flow.showAuthModal && (
        <AuthModal onComplete={flow.handleAuthComplete} onDismiss={flow.closeAuthModal} />
      )}

      <CocFindingsContext.Provider value={findings}>
      <DraftShell
        backTo={shell.backTo}
        backLabel={shell.backLabel}
        backAsButton={shell.backAsButton}
        title={shell.title}
        processType={config.processType}
        formVersion={draft?.updated_at ?? null}
        error={flow.error}
        assistant={shell.noAssistant ? null : flow.shellAssistant}
        reviewSuggestions={findings}
        flaggedPanelId={FLAGGED_PANEL_ID}
        checkedTextChanged={draft?.draft_modified_since_review === true}
        onTellAdmins={ctx.editProcessId ? undefined : () => setTelling("open")}
        phoneTitle={phoneTitle}
        saveNote={saveNote}
        hasUnsaved={hasUnsaved}
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
            onSubmit={openConfirm}
            disabled={submitting}
            kindState={kindState}
            setKindState={setKindState}
          />
        )}
      </DraftShell>
      </CocFindingsContext.Provider>

      {showConfirm && draft && (
        <ConfirmDialog
          title={confirm.title(ctx)}
          confirmLabel={confirm.confirmLabel(ctx)}
          busyLabel="Checking against the Code of Conduct…"
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

          <p className="confirm-check-note">Submitting runs the Code of Conduct check first.</p>
        </ConfirmDialog>
      )}

      {telling !== "closed" && draft && (
        <Modal
          title="Tell the admins"
          onClose={() => setTelling("closed")}
          dismissible={telling !== "sending"}
          describedBy="tell-admins-desc"
        >
          <p id="tell-admins-desc" className="tell-admins-text">
            Your {confirm.noun} goes to the admins as it is, marked as flagged by the Code of Conduct check. They read it
            and decide. It is not published until an admin approves it.
          </p>
          <label htmlFor="tell-admins-note" className="form-label">
            A note for the admins <span className="optional">(optional)</span>
          </label>
          <textarea
            id="tell-admins-note"
            className="form-textarea form-textarea-small"
            rows={3}
            maxLength={2000}
            value={tellNote}
            onChange={(e) => setTellNote(e.target.value)}
            placeholder="Why you think the check got this wrong"
            disabled={telling === "sending"}
          />
          {tellError && <p className="form-error">{tellError}</p>}
          <div className="confirm-actions">
            <button
              type="button"
              className="draft-submit-btn"
              onClick={sendToAdmins}
              disabled={telling === "sending"}
              aria-busy={telling === "sending"}
            >
              {telling === "sending" && <span className="btn-spinner" aria-hidden="true" />}
              {telling === "sending" ? "Sending…" : "Send to the admins"}
            </button>
            <button
              type="button"
              className="draft-secondary-btn"
              onClick={() => setTelling("closed")}
              disabled={telling === "sending"}
            >
              Go back to draft
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
